# pecore keychain spike

Data: 2026-11-18. Mac: Darwin 25.6.0. Utente di test: `pecore-spike` (UID 499, GID 499, nascosto, senza sessione grafica), raggiunto con `sudo -u pecore-spike` (regola NOPASSWD in `/etc/sudoers.d/pecore-spike`).

## Conclusione

Entrambi gli harness funzionano come utente dedicato, con queste condizioni:

1. Lanciare sempre con `sudo -H -u pecore-spike`. Con `sudo -u` semplice `HOME` resta quello del chiamante.
2. Credenziali su file, così il Keychain non serve a runtime:
   - Codex: `cli_auth_credentials_store = "file"` in `$CODEX_HOME/config.toml`.
   - Claude Code: `$CLAUDE_CONFIG_DIR/.credentials.json`. Claude lo legge, rinnova i token e li salva nel file anche su macOS. Solo `claude auth login` scrive esclusivamente nel Keychain, quindi il primo login richiede un Keychain disponibile e poi l'elemento va spostato nel file.
3. In alternativa, Keychain dedicato per l'utente, sbloccato dall'app prima di ogni lancio. Funziona, ma il logout dell'utente principale lo blocca, e con Codex `keyring` un Keychain bloccato apre finestre di password sul desktop dell'utente principale.

Login, invocazioni separate e logout/login dell'utente principale reggono in entrambi i casi. Altri harness (agy-cli, copilot-cli, opencode, pi) non testati.

## Setup

- Utente e gruppo: `dseditgroup -o create -i 499`, `sysadminctl -addUser -UID 499`, `createhomedir -c`, `IsHidden 1`. Il gruppo è anche `PrimaryGroupID` (sysadminctl assegna `staff` di default).
- `sysadminctl` stampa `No clear text password or interactive option was specified (adduser, change/reset password will not allow user to use FDE) !`. Riguarda solo FileVault.
- Dopo la creazione pecore-spike non ha nessun Keychain utente: `security default-keychain` dà `SecKeychainCopyDefault: A default keychain could not be found.`

### `sudo -u` e `HOME`

- `sudo -u pecore-spike` lascia `HOME=/Users/antoniocolagreco` (verificato con `echo $HOME`).
- Effetto su `security`: `Will not set default: UID=499 does not own directory /Users/antoniocolagreco` e `SecKeychainSetDomainDefault user: Write permissions error.`
- Con `sudo -H` `HOME` è `/Users/pecore-spike` e tutto funziona.

### Keychain dedicato

Creato come pecore-spike con `sudo -H`:

```
security create-keychain -p "$KCPW" ~/Library/Keychains/pecore.keychain-db
security default-keychain -d user -s ~/Library/Keychains/pecore.keychain-db
security list-keychains -d user -s ~/Library/Keychains/pecore.keychain-db
security set-keychain-settings ~/Library/Keychains/pecore.keychain-db
```

- `set-keychain-settings` senza opzioni toglie il blocco automatico: lo sblocco regge tra invocazioni `sudo` separate.
- Sblocco: `security unlock-keychain -p "$KCPW" ~/Library/Keychains/pecore.keychain-db`.
- Con il nome `login.keychain-db` la creazione riesce ma lo sblocco subito dopo fallisce: `SecKeychainUnlock ...: The user name or passphrase you entered is not correct.` (exit 51). Con `pecore.keychain-db` funziona.
- Dopo logout/login dell'utente principale il Keychain torna bloccato.

## Claude Code

- Versione: 2.1.327.
- Eseguibilità: `claude` funziona come pecore-spike senza modifiche. `sudo` su macOS non ha `secure_path`, quindi eredita il PATH del chiamante (`/Users/antoniocolagreco/.local/bin`); binario e directory sono 755. Fragile: dipende dal PATH di chi lancia sudo.
- Login: `CLAUDE_CONFIG_DIR=/Users/pecore-spike/.pecore/claude-a claude auth login --claudeai`. Stampa l'URL, il codice si incolla su stdin. Nessuna sessione grafica richiesta.
- Test: `claude -p "rispondi solo ok"`.

### Senza Keychain

- Login fallito, exit 1: `Couldn't log in: Couldn't save your login. If your Mac's keychain is locked, unlock it and log in again.`
- Nessun file scritto: `claude auth status` dà `"loggedIn": false`. `claude -p` dà `Not logged in · Please run /login`, exit 1.

### Con Keychain dedicato

- Login: `Login successful.`, exit 0.
- Credenziali: Keychain di pecore-spike, elemento `Claude Code-credentials-1d0904d8` (il suffisso dipende da `CLAUDE_CONFIG_DIR`). Nessun file di credenziali.
- Invocazioni separate: `ok`, exit 0, due volte.
- Keychain bloccato: `Not logged in · Please run /login`, exit 1, senza finestre di sistema. Il messaggio non dice che il Keychain è bloccato.
- Sblocco + `claude -p` nella stessa invocazione: `ok`, exit 0.
- Dopo logout/login dell'utente principale: senza sblocco `Not logged in · Please run /login`, exit 1. Con sblocco `ok`, exit 0. Il login regge.

### Con file `.credentials.json`

- Il contenuto dell'elemento Keychain è il JSON `{"claudeAiOauth": {accessToken, refreshToken, expiresAt, refreshTokenExpiresAt, scopes, subscriptionType, ...}}`.
- Prova: nuovo login in claude-a, elemento spostato in `claude-a/.credentials.json` (0600) ed eliminato dal Keychain, Keychain bloccato.
  - `claude -p`: `ok`, exit 0.
  - `expiresAt` forzato a 1000: Claude rinnova il token, risponde `ok`, exit 0, e salva i nuovi token nel file (`expiresAt` aggiornato). Nel Keychain non scrive nulla.
  - Invocazione successiva: `ok`, exit 0.
- Due config dir con la stessa copia dei token si invalidano a vicenda. Prova: token copiati da claude-a (Keychain) in claude-b (file), scadenza forzata in claude-b. Esito: `Failed to authenticate: OAuth session expired and could not be refreshed`, exit 1. Claude ha svuotato `accessToken` e `refreshToken` nel file e anche claude-a è risultato `loggedIn: false`.

### Config dir senza login (claude-b)

`Not logged in · Please run /login`, exit 1. Non riusa claude-a.

## Codex

- Versione: codex-cli 0.170.0. Eseguibile da `/opt/homebrew/bin`.
- Login: `CODEX_HOME=/Users/pecore-spike/.pecore/codex-a codex login --device-auth`. Richiede di abilitare il device code nelle impostazioni di sicurezza dell'account ChatGPT.
- Test: `codex exec --skip-git-repo-check "rispondi solo ok"` (circa 2.2k token a chiamata).

### `cli_auth_credentials_store = "file"`

- Login: `Successfully logged in`, exit 0.
- Credenziali: `codex-a/auth.json` (0600). Niente nel Keychain.
- Invocazioni separate: `ok`, exit 0, due volte.
- Dopo logout/login dell'utente principale: non ritestato, perché il passaggio a `keyring` ha rimosso `auth.json`. Non dipende dal Keychain.

### `cli_auth_credentials_store = "keyring"`

- Passando da `file` a `keyring` il login esistente viene ignorato: `codex login status` dà `Not logged in`. Serve un nuovo login.
- Login: `Successfully logged in`, exit 0. `auth.json` rimosso.
- Credenziali: Keychain di pecore-spike, elemento `Codex Auth` (account `cli|<id>`).
- Invocazioni separate: `ok`, exit 0, due volte.
- Keychain bloccato: macOS mostra la finestra della password del Keychain nella sessione grafica dell'utente principale e il processo resta bloccato finché qualcuno non risponde. Dopo il logout/login sono comparse circa 5 finestre. Dopo Annulla: 5 tentativi `Reconnecting...` poi `ERROR: unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses`, exit 1.
- Sblocco + `codex exec`: `ok`, exit 0, anche dopo logout/login. Il login regge.

### Config dir senza login (codex-b)

5 tentativi `Reconnecting...` poi `ERROR: unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses`, exit 1. Non riusa codex-a. Il messaggio non dice che manca il login.

## Implicazioni per l'app

- Usare sempre `sudo -H -u`.
- Preferire credenziali su file: niente Keychain a runtime, niente finestre sul desktop dell'utente, niente dipendenza dal logout.
- Claude: il primo login richiede un Keychain. Da testare: login fatto come utente principale con un `CLAUDE_CONFIG_DIR` dedicato, poi l'app sposta l'elemento nel `.credentials.json` di pecore-spike. Ogni config dir deve avere la sua copia unica dei token.
- Se si usa il Keychain, sbloccarlo prima di ogni lancio.
- Gli errori di autenticazione mancante sono poco chiari (Claude dice `Not logged in` anche con Keychain bloccato, Codex dà un 401 dopo 5 retry). L'app deve verificare lo stato con `claude auth status` e `codex login status` invece di interpretare gli errori.
- Non affidarsi al PATH ereditato: lanciare gli harness con percorso assoluto.
