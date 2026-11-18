# PeCore: analisi e specifica tecnica

Versione 0.5, 17 novembre 2026.

**PeCore** (pronunciato *PEH-koh-reh*, /ˈpɛ.ko.re/) è una software factory personale: trasforma ticket in pull request verificate, usando agenti AI di più fornitori, sotto il controllo di un motore deterministico.

Il documento ha tre parti:

- **Parte I, Analisi:** obiettivi, principi, flusso, decisioni di design.
- **Parte II, Specifica tecnica:** directory, storage, schemi, interfacce, CLI, API, perimetro della fase 1.
- **Parte III, Piano:** roadmap, rischi, decisioni prese, domande aperte.

Legenda:

- **[Verificato]:** controllato su documentazione o fonti online a novembre 2026.
- **[Decisione]:** scelta presa.
- **[Proposta]:** scelta proposta, da confermare o correggere in implementazione.
- **[Aperto]:** domanda senza risposta.

### Storia delle versioni

- **0.1:** principi, pipeline, gate, harness, roadmap.
- **0.2:** control plane ed execution plane, policy separata, evidenze legate al commit, plugin degli harness, handbook.
- **0.3:** pipeline componibile, tier di modelli, JSONC e Zod, TypeScript, UI web, eventi e telemetria, Copilot CLI, runner offline.
- **0.4:** nome peCore; prima specifica tecnica completa.
- **0.5:** pilota PDND rimosso; directory unica di peCore, nulla nel repo del progetto; recipe come grafi liberi di nodi e frecce, costruiti dall'utente; orchestratore come intake; nodi deterministici di controllo; approvazione configurabile (`policy_gate`, `auto_approve_if`, `human_approve`); uscite configurabili; rischio per hunk deciso dall'approver; knowledge base solo Markdown con selezione per ruolo e nodo; source con quattro operazioni; rete scelta per nodo; telemetria senza SDK; limiti di concorrenza; appendici ridotte.

---

# PARTE I: ANALISI

## 1. Obiettivo

peCore trasforma ticket in pull request verificate. Una app di controllo:

- gestisce più factory, ognuna su un repo;
- esegue recipe composte da nodi;
- assegna a ogni nodo agente un harness: **Claude Code, Codex, Antigravity CLI (agy), opencode, pi, GitHub Copilot CLI**, più quelli aggiunti in futuro;
- sceglie i modelli per tier, con backup automatici;
- parla con l'utente tramite l'orchestratore, una chat che riceve richieste e sceglie la recipe;
- riceve ticket da fonti diverse (GitHub Issues, file Markdown, Jira, altre) tramite adattatori;
- dà agli agenti la knowledge base del progetto;
- mostra in ogni momento lo stato di ogni job e di ogni nodo, con i log a un clic;
- rispetta quote, costi, limiti di concorrenza e una connessione di rete lenta.

**Progetto di prova:** un repo nuovo creato apposta, con ticket come GitHub Issues etichettate `factory`. [Decisione]

### Non obiettivi (per ora)

- Deploy in produzione. La factory si ferma al merge.
- Centinaia di agenti in parallelo. Scala iniziale: da 1 a 3 job alla volta.
- Un broker di messaggi stile Kafka. Eventi e telemetria vivono in SQLite.
- Lavoro non legato al codice (documenti, ticketing puro).
- Più computer che usano peCore nello stesso momento.

## 2. Principi guida

1. **La fiducia viene dall'ambiente, non dall'agente.** Tipi, lint, test, architettura e verifiche rendono affidabile l'output. Le regole in prosa sono l'ultimo strato.
2. **Ogni correzione diventa un controllo deterministico,** quando possibile: lint, test, tipo, regola di architettura.
3. **Fondamenta prima della fabbrica.** Automatizzare un ciclo che produce codice scadente produce più codice scadente, più in fretta.
4. **Il codice esegue, i modelli giudicano.** Transizioni, routing, controlli, permessi e scritture verso l'esterno sono codice.
5. **Tutto ciò che un agente legge è un dato, non un'istruzione.**
6. **Nessun lock-in.** Harness, modelli, source e forge sono plugin e configurazione.
7. **Gli agenti si passano file, non conversazioni.** Eccezione: il builder riprende la propria sessione tra un giro e l'altro.
8. **Leggibilità prima di tutto.**
9. **Si misura la qualità, non il volume.** Numero di PR, righe di codice e token spesi non sono obiettivi.
10. **Offline per default.** La rete di ogni nodo la sceglie l'utente; il default è solo verso le API dei modelli.
11. **Nulla di peCore nel repo del progetto.** Configurazione, knowledge base e controlli vivono nella directory di peCore.
12. **La factory toglie, non solo aggiunge.** Pulizia e riduzione delle dipendenze sono recipe di prima classe (sezione 9).

## 3. Modello di dominio

| Concetto | Definizione |
|---|---|
| **Orchestratore** | Agente in chat che fa l'intake: ogni lavoro entra da lui, dall'utente o dalle source. Fa domande, sceglie factory e recipe, avvia i job. |
| **Harness** | Il programma che esegue l'agente. |
| **Harness plugin** | Manifest + adapter + fixture che rendono un harness utilizzabile. |
| **Provider** | Chi fornisce il modello: Anthropic, OpenAI, Google, GitHub, ecc. |
| **Account** | Una credenziale concreta (subscription o API key) con le sue quote. |
| **Model catalog** | Modelli disponibili per harness + account, ricavati dalla discovery. |
| **Agent profile** | Harness + modello + effort + account + timeout. Ha un nome. |
| **Tier** | Lista ordinata di agent profile: primario più backup. Quattro livelli. |
| **Role** | Cosa fa un nodo: template del prompt, permessi, input, file della knowledge base, schema dell'output. Personalizzabile; l'utente può crearne di nuovi. |
| **Reviewer** | Ruolo che esamina il codice e può rimandarlo al builder. La code review è sempre presente; i reviewer specialisti (security, UI, DDD, ...) si aggiungono. |
| **Binding** | Collegamento ruolo → tier (o profilo) nella factory. |
| **Recipe** | Grafo di nodi e frecce costruito dall'utente, con le impostazioni di ogni nodo. Può essere vuota. |
| **Node** | Un passo della recipe: agente con un ruolo, controllo deterministico, approvazione, uscita. |
| **Freccia** | Collega l'esito di un nodo al nodo successivo (es. typecheck `failed` → builder). |
| **Node run** | Un'esecuzione concreta di un nodo in un job (es. builder al giro 2). |
| **Source** | Da dove arrivano i ticket. |
| **Forge** | Dove vive il codice e si aprono le PR (GitHub all'inizio). |
| **Work item** | Ticket normalizzato, qualunque sia la source. Contenuto sempre non attendibile. |
| **Knowledge base** | Libreria Markdown del progetto: architettura, dominio, convenzioni, decisioni. Si consulta. |
| **Policy** | Regole globali, permessi e limiti. |
| **Factory** | Repo + source + recipe + binding + reviewer + knowledge base + comandi dei controlli + limiti. |
| **Job** | Un work item che attraversa una recipe. |
| **Attempt** | Un tentativo di eseguire uno step agent o check: profilo, versione, commit iniziale e finale, esito. |
| **Controllo** | Nodo deterministico su un commit preciso (build, typecheck, lint, ...). Risponde solo passa o non passa. |
| **Evidence bundle** | Prove su cui si basa la decisione per un commit (`verification.json`). |
| **Domain event** | Fatto del dominio, append-only. Fonte di verità dello stato. |
| **Span** | Unità di lavoro con inizio, fine, genitore e attributi. Base del tracing. |
| **Runner** | Ambiente isolato ed effimero in cui gira un attempt. |
| **Belato** | Il modulo delle notifiche. |

### Bounded context [Proposta]

| Contesto | Responsabilità | Aggregati principali |
|---|---|---|
| **Orchestrazione** | Job, recipe, esecuzione dei blocchi, coda umana | `Job` |
| **Registro harness** | Plugin, discovery, healthcheck, profili, tier | `HarnessRegistration`, `AgentProfile`, `Tier` |
| **Intake** | Orchestratore, source, work item, deduplicazione, writeback | `Conversation`, `WorkItem` |
| **Knowledge base** | Pagine, proposte, selezione per ruolo | `KnowledgeBase` |
| **Account e quote** | Account, lease di quota, consumi, limiti di concorrenza | `Account` |
| **Forge** | Mirror, branch, PR, merge serializzati | `Repository` |
| **Esecuzione** | Runner, immagini, servizi del job, proxy di rete | `RunnerImage` |
| **Osservabilità** | Tracce, log, metriche | (nessun aggregato: telemetria) |

Proposta per la fase 1: l'attempt è parte dell'aggregato `Job` (al massimo pochi attempt paralleli per job).

## 4. Architettura

```
┌──────────────────────── CONTROL PLANE (fidato) ────────────────────────┐
│  UI web (React) ── API HTTP + WebSocket ── Daemon peCore (Node)        │
│                                       ├─ orchestratore (chat)          │
│                                       ├─ motore delle recipe           │
│                                       ├─ policy, scheduler, limiti     │
│                                       ├─ plugin: harness, source, forge│
│                                       ├─ mirror locali dei repo        │
│                                       ├─ segreti cifrati               │
│                                       ├─ proxy di rete dei runner      │
│                                       ├─ events.db (dominio)           │
│                                       ├─ telemetry.db + log JSONL      │
│                                       └─ Belato (notifiche)            │
└───────────────┬────────────────────────────────────────────────────────┘
                │ avvia, osserva, ferma
┌───────────────▼──────── EXECUTION PLANE (non fidato) ───────────────────┐
│  Runner effimero per attempt: container OCI                             │
│   - immagine del progetto con dipendenze già installate                 │
│   - copia del repo sul commit di partenza, dal disco locale             │
│   - file della knowledge base permessi al nodo, in sola lettura         │
│   - harness con token segnaposto; il proxy mette quello vero (16)       │
│   - servizi esterni solo via MCP di peCore, senza credenziali           │
│   - nessuna credenziale GitHub, home pulita, limiti di risorse          │
│   - rete solo attraverso il proxy, secondo il livello del nodo          │
│  Servizi del job (Postgres, Kafka, ...) accanto al runner, rete privata │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Daemon:** processo Node sempre acceso, senza interfaccia. Se chiudi la UI i job continuano. Avviato da un servizio utente di systemd (Linux) o da un LaunchAgent (macOS). Al riavvio riconcilia lo stato (sezione 12).
- **API HTTP:** presente dalla fase 1. La CLI la usa; la UI della fase 2 userà la stessa API. [Decisione]
- **UI:** web app React servita dal daemon in locale, installabile come PWA. Electron solo se servono tray o scorciatoie globali.
- **Linguaggio:** TypeScript per tutto.
- **Codice generato** solo nell'execution plane. Il worktree separa il lavoro su git ma non è un confine di sicurezza.
- **Push, PR e scritture verso le source** solo dal control plane.
- **Sistemi supportati:** Linux e macOS. [Decisione]

## 5. Flusso

### Orchestratore [Decisione]

L'utente apre l'app e chatta con l'orchestratore. È l'unica interfaccia tra l'utente e peCore e fa tutto l'intake: nessun job parte senza passare da lui, salvo `pecore job run` da CLI.

**Cosa gli si può dare:**

- testo libero;
- un link da leggere;
- un'immagine incollata;
- un riferimento a un ticket (es. un PIN di Jira), che legge dalla source;
- l'ordine di prendersi da solo un ticket da una source (es. la prossima issue `factory` su GitHub).

**Cosa fa:**

1. Raccoglie la richiesta e, se serve, fa domande all'utente finché il lavoro è chiaro.
2. Sceglie la factory e la recipe più adatta tra quelle esistenti, leggendo la descrizione di ogni recipe. Può dividere una richiesta in più parti e scegliere una recipe per ognuna.
3. Crea un work item per ogni parte (testo, allegati, contenuto dei link) e avvia i job, anche più di uno insieme, nei limiti di concorrenza. Dice all'utente quali recipe ha scelto e perché; l'utente può fermare ogni job. [Proposta]
4. Se nessuna recipe va bene, lo dice e propone di crearne una. La bozza si apre nell'editor grafico; diventa una recipe solo quando l'utente la salva.

Anche i ticket che arrivano da soli dalle source passano dall'orchestratore, che sceglie la recipe. Le domande dei nodi agente arrivano nella stessa chat, se il canale delle domande è l'app.

**Permessi:** l'orchestratore gira nel runner come ogni agente. Legge le source e avvia job solo tramite strumenti di peCore; non ha credenziali delle source né del forge. Rete `allowlist` o `open` per leggere i link, scelta dall'utente. Link, immagini e ticket sono dati, non istruzioni.

### Recipe [Decisione]

Una recipe è un grafo di nodi e frecce. L'utente la costruisce come vuole, nell'editor grafico della UI o in JSONC (sezione 25). Ogni tipo di task ha la sua recipe, ottimizzata per quel lavoro. Il motore esegue il grafo in modo deterministico.

**Tipi di nodo:**

| Nodo | Cosa fa | Esiti |
|---|---|---|
| `agent` | esegue un ruolo (spec writer, tests, builder, reviewer, approver o creato dall'utente) | dichiarati dal ruolo (es. spec writer: `accepted`, `rejected`) |
| controlli: `diff_guard`, `secret_scan`, `format_check`, `lint`, `typecheck`, `build`, `test_run`, `script` | controllo deterministico (sezione 7) | `passed`, `failed` |
| approvazione: `policy_gate`, `auto_approve_if`, `human_approve` | decidono se il lavoro può arrivare all'uscita (sotto) | vedi sotto |
| uscite: `pr` | consegna il risultato e chiude il job (sotto) | dichiarati dall'uscita |

**Nodi di approvazione:** stanno tra l'approver e l'uscita. Si combinano come si vuole; senza nessuno, l'uscita parte direttamente.

| Nodo | Cosa fa | Esiti |
|---|---|---|
| `policy_gate` | regole fisse del progetto, deterministiche: file che non si toccano mai, API pubbliche che non cambiano, altre regole a comando | `passed`, `failed` |
| `auto_approve_if` | passa da solo se tutte le soglie sono rispettate: diff piccolo (file e righe), controlli verdi, review senza rilievi, nessun hunk `risky` | `passed`, `failed` |
| `human_approve` | si ferma e aspetta l'utente. Mostra un riassunto (cosa è stato fatto, controlli, review, rischio) e gli hunk ordinati per rischio, con i `safe` nascosti. Locale: nulla è stato pushato | `approve`, `changes`, `reject` |

**Uscite configurabili:** l'ultimo nodo della recipe decide cosa produce il job.

1. **`pr`, PR su repo:** push del branch su `factory/*`, apertura della PR, merge serializzato. Impostazione `merge`: `auto` (merge se la PR non richiede approvazioni esterne) o `off` (il job finisce con la PR aperta). Esiti: `merged`, `open`.

**Regole del grafo:**

- **Frecce:** partono da un esito e arrivano a un nodo. Un esito senza freccia chiude il job con quell'esito.
- **Recipe vuota:** valida. Il job si apre e si chiude subito.
- **Frecce all'indietro:** ammesse, con `maxRounds` (default 3). Oltre il limite il job passa all'utente.
- **Parallelo:** più frecce dallo stesso esito partono insieme. Il job va avanti quando tutti i nodi partiti insieme hanno finito. Se gli esiti portano a nodi diversi, vince la freccia all'indietro e il nodo di arrivo riceve tutti i rilievi. [Proposta]
- **Nodi opzionali:** un nodo `agent` può essere opzionale. Parte solo se lo spec writer lo sceglie (es. reviewer specialisti).
- **Nodi per subtask:** un nodo con `perSubtask` gira una volta per ogni subtask dello spec writer, in parallelo. Ogni subtask lavora nel suo runner, dallo stesso commit di partenza, su un branch `factory/<job>/<n>`. Quando tutti hanno finito, peCore unisce i branch in quello del job; se c'è un conflitto, lo risolve il builder. [Proposta]
- **Domande:** ogni nodo agente può chiedere informazioni. La domanda va sul canale configurato (default per factory, modificabile per job). Il nodo riparte alla risposta.
- **Validazione:** l'editor accetta solo grafi validi: un'uscita non ha frecce in uscita; la soglia "nessun hunk `risky`" di `auto_approve_if` richiede un approver prima.
- **Esito sul ticket:** a fine job peCore scrive sul ticket l'esito (PR, motivo del rifiuto, errore).

**Scelta della recipe:** la fa l'orchestratore. Da CLI si può indicare a mano con `--recipe`.

### Recipe predefinite

| Recipe | Contenuto | Fase |
|---|---|---|
| `feature` | il grafo sotto | 1 |
| `bugfix` | come `feature`; lo spec writer indica sempre un regression test | 1 |
| `handbook` | crea o aggiorna l'handbook da sorgenti di ogni tipo; produce proposte, non PR (sezione 11) | 2 |
| `cleanup` | lo spec writer cerca codice morto, pattern deprecati, pagine della knowledge base mai lette | 4 |
| `dependency-diet` | lo spec writer cerca pacchetti banali da sostituire con codice locale e test | 4 |

Sono un punto di partenza: l'utente le modifica o ne crea di nuove.

### Grafo di `feature`

```
ticket → spec writer → ( tests → builder ) × subtask in parallelo → controlli → reviewer → approver → policy gate → auto approve if → (se non passa) human approve → uscita pr (merge auto)
controlli = diff guard → secret scan → format check → lint → typecheck → build → test run
```

1. **Ticket:** lo scrive l'utente, già con le specifiche.
2. **Spec writer:** è il PM. Valuta se il ticket ha ancora senso ed è fattibile e scrive la spec: cosa fare, criteri di accettazione, cosa devono verificare i test. Sceglie i reviewer specialisti.
   - **Subtask:** se il task è troppo grande, lo divide in subtask. Per ogni subtask può scegliere un agente diverso, tra i profili permessi dalla recipe. I subtask lavorano in parallelo.
   - **Rifiuto:** il job si chiude subito; il motivo viene scritto sul ticket; arriva una notifica.
3. **Tests:** scrive solo i test, seguendo le indicazioni dello spec writer. Non tocca il codice.
4. **Builder:** scrive solo il codice. Non modifica i test: se lo fa, `diff_guard` fallisce.
5. **Controlli:** in fila, dal più veloce. Al primo che fallisce, il builder riceve il log. Se fallisce `diff_guard`, il job si ferma e passa all'utente.
6. **Reviewer:** la code review generica parte sempre e verifica anche che i test rispettino la spec. I reviewer specialisti (es. security, UI) scelti dallo spec writer partono in parallelo. Ognuno può rimandare il lavoro al builder (`changes_code`) o al nodo tests (`changes_tests`).
7. **Approver:** classifica ogni hunk del commit come `safe` o `risky`, guardando il codice reale. Il job è `risky` se almeno un hunk lo è. [Decisione]
8. **Policy gate:** regole fisse del progetto. Se fallisce, il builder riceve la regola violata.
9. **Auto approve if:** se diff piccolo, controlli verdi, review pulita e nessun hunk `risky`, si passa direttamente all'uscita.
10. **Human approve:** solo se l'auto approvazione non passa. Si ferma e aspetta l'utente, con riassunto e hunk rischiosi. L'utente sceglie:
    - **Approve:** si passa all'uscita.
    - **Request changes:** note per il builder; il job torna al builder e ripercorre controlli, reviewer e approver. Al nuovo giro l'approver classifica di nuovo.
    - **Reject:** il job viene cancellato. Nulla è stato pushato.
11. **Uscita `pr` (`merge: auto`):** push e PR; merge se la PR non richiede approvazioni esterne, altrimenti il job finisce con la PR aperta.

Per far vedere sempre il codice all'utente prima della PR: togliere `auto_approve_if`. Per lasciare la PR aperta senza merge: `merge: off`.

### Regole valide per ogni recipe

- Una PR per job.
- Ogni controllo, review e approvazione è legato all'esatto `head_sha`. Se il branch cambia, le approvazioni precedenti decadono.
- Un nodo agente raggiunto di nuovo da una freccia all'indietro riprende la stessa sessione dell'harness. Se cambia modello, si riparte da zero con un nuovo attempt.
- Merge serializzati dal daemon: uno alla volta, allineamento con main, controlli ripetuti. [Verificato] La merge queue di GitHub non è disponibile sui repo personali.

## 6. Modelli: tier, backup, promozione

- **Quattro tier** di agent profile: `frontier`, `strong`, `standard`, `cheap`. Un profilo è modello + effort; quale sia migliore si decide con la valutazione, non a priori.
- **Effort** specifico dell'harness, valori ammessi dichiarati nel manifest.
- **Tier per nodo** nella recipe.
- **Backup solo per disponibilità** (quota, rate limit, errore dell'harness, modello non disponibile). Mai per qualità.
- **Mai scendere di tier in silenzio.** Tier esaurito: il job aspetta. La policy può consentire la discesa per ruoli specifici.
- **Scelta vincolata:** vince il primo profilo che rispetta la policy (es. code reviewer di fornitore diverso dal builder).
- **Cambio di modello = nuovo attempt** dal commit iniziale; evento `attempt.fallback_selected` con il motivo.
- **Promozione** opzionale per recipe: dopo N giri falliti, il tier sale.
- **Quote:** se l'harness espone la quota residua, il backup scatta prima di esaurirla, con una riserva per il lavoro interattivo.

### Concorrenza [Decisione]

Limiti configurabili: job contemporanei e agenti contemporanei, globali e per provider. Ogni account ha anche il suo `maxParallel`. Lo scheduler rispetta il più stretto.

## 7. Controlli e test

### Nodi di controllo [Decisione]

Ogni controllo è un nodo della recipe. Risponde solo `passed` o `failed`; se fallisce, il nodo collegato (di solito il builder) riceve il log.

| Nodo | Cosa controlla |
|---|---|
| `diff_guard` | diff troppo grande (file e righe oltre le soglie); commit estranei al job, per esempio dopo un rebase sbagliato; test del nodo tests modificati dal builder |
| `secret_scan` | segreti nel diff, con un modello locale piccolo: il diff non esce dalla macchina [Proposta] |
| `format_check` | formattazione |
| `lint` | lint, inclusi divieto di `.skip` e `.only` nei test |
| `typecheck` | tipi |
| `build` | build reale |
| `test_run` | test da eseguire, scelti per nodo (es. solo unit, unit e integration) |
| `script` | comando libero: regole di architettura, breaking change OpenAPI (es. `oasdiff`), dipendenze vulnerabili, altro |

- **Configurazione:** il comando di ogni controllo sta in `factory.jsonc`, nella directory di peCore, non nel repo. Soglie di `diff_guard` e modello di `secret_scan` anche.
- **Comandi:** chiamano direttamente gli strumenti (`tsc`, `eslint`, `vitest`, ...) con argomenti fissi. Non usano gli script di `package.json`, così modificarli non indebolisce i controlli.
- **Dove girano:** nel runner, perché eseguono codice del branch. `diff_guard` gira nel control plane, perché legge solo git.
- **CI:** i controlli sono separati dalla CI del progetto. Per il merge contano entrambi: peCore aspetta anche la CI verde.
- **Ordine:** dal più veloce, errori leggibili dall'agente. Ripetuti dopo l'allineamento con main.

Fase 1: tutti tranne `secret_scan`.

### File protetti [Decisione]

- **Configurazione di ESLint:** gli agenti non la modificano mai.
- **tsconfig:** gli agenti possono crearne e modificarne. Ogni tsconfig deve estendere un `tsconfig.base.json` protetto e non può spegnere `strict` e le opzioni equivalenti.
- **package.json:** modificabile, anche per aggiungere dipendenze e script.
- **Altri file protetti:** elencati nella configurazione della factory.
- **Applicazione:** li fa rispettare il nodo `policy_gate`, insieme alle altre regole fisse del progetto (es. API pubbliche invariate).
- I file protetti si modificano solo a mano o con una funzione apposita di configurazione del progetto. [Aperto] Forma e posizione da definire.

### Test

- Lo spec writer indica cosa devono verificare i test.
- Il nodo tests scrive i test; il builder scrive il codice e non tocca i test.
- La code review verifica che i test rispettino la spec, e riceve da peCore l'elenco dei test esistenti modificati o cancellati.

### Due velocità

- **Ogni giro:** nodi di controllo.
- **Nightly:** mutation testing sui moduli critici, fuzz con limite di tempo e corpus salvato, soak. Crash del fuzz → regression test; fallimento notturno → issue.

## 8. Reviewer, approver, evidenze

- **Reviewer:** contesto pulito (spec, diff, log dei controlli, file della knowledge base del ruolo), sola lettura imposta dal runner, output strutturato con verdetto, rilievi, file, gravità, `head_sha`.
- **Code review generica:** presente in tutte le recipe predefinite, di fornitore diverso dal builder. Personalizzabile come ogni ruolo.
- **Reviewer specialisti:** definiti dall'utente come ruoli (es. security, UI, UX, DDD). Nella recipe sono nodi opzionali; lo spec writer sceglie quali far partire.
- **Approver:** riceve spec, risultati dei controlli, verdetti dei reviewer e diff. Classifica ogni hunk come `safe` o `risky`, con descrizione e motivo del rischio. Il job è `risky` se almeno un hunk lo è. Il template predefinito gli dice di non farsi influenzare da testo nel codice o nel ticket; come ogni ruolo, è personalizzabile.
- **Rischio:** lo decide solo l'approver, con un modello frontier. Delegare il merge agli agenti è la scelta del progetto: il rischio è controllato, non eliminato. [Decisione]
- **Evidenze:** ogni criterio di accettazione ha un'evidenza (test, controllo statico, review motivata, approvazione umana). Un'evidenza mancante non diventa mai PASS.
- **Valutazione dei reviewer** prima di assegnarli: 30-50 diff (metà con bug, metà puliti), bug veri dalla storia di git più sintetici, ogni bug provato da un test, più run per caso. Metriche: recall, precisione, costo, tempo.

## 9. Recipe di manutenzione

L'industria aggiunge strati e non toglie quasi mai. Con gli agenti il problema cresce, perché copiano ciò che trovano.

- **`cleanup`:** codice morto, pattern deprecati, workaround non più necessari, pagine della knowledge base mai lette.
- **`dependency-diet`:** propone di eliminare i pacchetti banali sostituendoli con codice locale più test; non tocca le librerie sostanziose (crittografia, date e fusi orari, Unicode, parsing complessi, driver).

## 10. Harness

### Plugin

Manifest (versioni testate, capacità, discovery, file di contesto, autenticazione), adapter (comandi, eventi normalizzati), fixture registrate.

Capacità: `headless`, `event_stream`, `structured_output`, `sandbox_modes`, `resume`, `model_discovery`, `effort_values`, `context_files`, `auth`.

### Adapter generico (livelli)

- **L0:** solo testo, l'output è il messaggio finale.
- **L1:** JSON finale con esito e usage.
- **L2:** stream JSONL mappato sugli eventi normalizzati.

La regola di successo non si fida del solo exit code (vedi agy). Formato del manifest: sezione 25.

### Compatibilità [Verificato]

| | Claude Code | Codex | agy | opencode | pi | Copilot CLI |
|---|---|---|---|---|---|---|
| Non interattivo | `claude -p` | `codex exec` | `agy -p` | `opencode run` | `pi -p` | `copilot -p` |
| Eventi | `--output-format stream-json` | `--json` | `--output-format stream-json` | `--format json` | `--mode json` | `--output-format=json` |
| Schema imposto | `--json-schema` | `--output-schema` | `--json-schema` | da verificare | da verificare | da verificare |
| Modello | `--model` | `-m` | `--model <slug>` | `-m provider/model` | `--provider`, `--model` | `--model` |
| Effort | da manifest | reasoning effort | `--effort` | da verificare | `--thinking` (`off`…`max`) | da verificare |
| Permessi | `--allowedTools` | `-s read-only` (default), `workspace-write` | regole in settings | approvazione solo con `--auto` | da verificare | `--allow-tool`, `--deny-tool`; `--allow-all-tools` richiesto in non interattivo |
| Ripresa | `--resume` | sì | `--continue` | `--session`, `--continue` | `-c`, `--session` | `--continue`, `--resume` |
| Discovery modelli | nessun comando | `codex debug models` (sperimentale) | `agy models` | `opencode models` | `pi --list-models` | stringhe in `copilot help` |
| File di contesto | `CLAUDE.md` | `AGENTS.md` (+ fallback configurabili) | `AGENTS.md`/`GEMINI.md` (GEMINI prevale), `.agents/rules/*.md` | `AGENTS.md` (V2: niente fallback su CLAUDE.md) | `AGENTS.md` o `CLAUDE.md`; `--no-context-files` | `AGENTS.md` e simili; `--no-custom-instructions` |
| Autenticazione nel runner | `CLAUDE_CODE_OAUTH_TOKEN` da `claude setup-token` | file di login ChatGPT o API key | credenziali in cache [Aperto] | API key | API key (anche da comando) | token GitHub solo con permesso Copilot |

### Trappole [Verificato]

- **agy:** azioni da approvare negate in silenzio, exit code 0. Autenticazione interattiva una volta. `--print-timeout` illimitato.
- **Codex:** con il login ChatGPT alcuni modelli possono mancare.
- **opencode:** l'agent `plan` è un controllo applicativo, non una sandbox.
- **pi:** print mode automatico con I/O rediretto; usage a zero fino alla fine.
- **Copilot CLI:** il token è un token GitHub: nel runner solo con permesso Copilot, nessun accesso ai repo.
- **Claude Code:** esistono segnalazioni di errori 401 con `setup-token` in container: da provare in fase 0A.
- **In generale:** il confine reale è il runner.

### Discovery

Per account, cache con data, fallback al manifest statico (segnalato), validazione opzionale con run minima, override manuale, healthcheck (versione nel range testato, autenticazione, modello disponibile).

## 11. Knowledge base

- **Formato:** le pagine sono solo file Markdown. Le sorgenti da cui nascono possono essere di ogni tipo (sotto). [Decisione]
- **Posizione:** nella directory di peCore, per factory (`factories/<id>/knowledge/`). Mai nel repo.
- **Selezione:** ogni ruolo dichiara quali file può leggere, con glob (es. `architecture/**`). La recipe può aggiungere o togliere file per ogni nodo. [Decisione]
- **Applicazione:** il runner monta solo i file permessi al nodo, in sola lettura. Il limite non dipende dal prompt.
- **Regole obbligatorie:** stanno nel contesto del ruolo o diventano nodi di controllo. La knowledge base è consultazione.
- **Proposte:** qualsiasi agente può proporre nuove pagine, scrivendole in una cartella di output del runner. peCore le raccoglie, l'app notifica, l'utente le importa, le scarta o le modifica. All'importazione l'utente sceglie a quali ruoli assegnarle; una pagina che nessun ruolo legge viene segnalata.
- **Misura:** dai log degli strumenti si vede quali pagine gli agenti aprono. Una pagina mai aperta è candidata alla revisione.

### Creazione dell'handbook [Proposta]

Ogni progetto ha un handbook, cioè la sua knowledge base. Si crea con la recipe predefinita `handbook`: l'utente chiede all'orchestratore di crearlo o aggiornarlo e indica le sorgenti.

**Sorgenti possibili:**

- una cartella locale con file di ogni tipo: PDF, Markdown, immagini, documenti;
- codice del repo e documenti già presenti (README, ADR, commenti);
- link a pagine web;
- file caricati in chat;
- pagine di wiki e tracker (Confluence, Notion, Jira, issue GitHub), lette tramite adattatori;
- risposte dell'utente: l'agente fa domande su ciò che non trova scritto.

**Gestione dall'app:** nella pagina Handbook della factory l'utente aggiunge, toglie e vede le sorgenti: carica file, sceglie una cartella, incolla link, collega uno spazio Confluence. peCore le salva in `factories/<id>/handbook-sources/` (file copiati, link e riferimenti in `sources.jsonc`).

**Come funziona:**

1. peCore raccoglie le sorgenti e le passa al nodo come file in sola lettura. Le sorgenti con credenziali le legge peCore con i suoi adattatori; l'agente non riceve credenziali.
2. Gli agenti della recipe scrivono le pagine come proposte (sopra), una per argomento: architettura, dominio, convenzioni, decisioni.
3. Ogni pagina indica in testa le sorgenti usate e la data, così si può rigenerare quando la sorgente cambia.
4. L'utente importa, modifica o scarta le proposte e assegna i ruoli.

### Commenti nel codice (convenzione di partenza)

- I commenti spiegano il **perché**, non il cosa: soprattutto regole di business.
- Indicano la **fonte** (ticket, norma, sezione della spec).
- Sono affiancati da un **test con il nome della regola** (es. `rejects refund after 14 working days`).
- Vietati i commenti che giustificano una scorciatoia: si corregge la causa.

## 12. Motore

- **Macchina a stati** nel codice che rifiuta le mosse non valide (sezione 27).
- **Job, node run, attempt.** Un attempt fallito non è un job fallito.
- **Motivi di fallimento tipizzati:** `HARNESS_ERROR`, `AUTH_ERROR`, `QUOTA_EXHAUSTED`, `TIMEOUT`, `CHECK_FAILED`, `REVIEW_CHANGES`, `POLICY_BLOCKED`, `FORGE_CONFLICT`, `CANCELLED`, `STALLED`.
- **Effetti esterni in due tempi:** intenzione (`*.requested`) ed esito (`*.completed`/`*.failed`). Identificatori stabili. Prima di ripetere, si interroga il sistema esterno.
- **Riconciliazione al riavvio** con processi, runner, branch, PR e check reali.
- **Agente bloccato:** nessun evento per N minuti → `STALLED`, cancellazione.
- **Cancellazione:** runner e figli fermati, quote liberate, log e artefatti conservati. Timeout soft e hard.

## 13. Eventi e telemetria

Due mondi separati, collegati dagli id. Il motore non legge mai la telemetria per decidere.

| | Eventi di dominio | Telemetria |
|---|---|---|
| Ruolo | Fonte di verità dello stato | Osservare |
| Contenuto | Fatti del dominio | Tracce, log, metriche |
| Volume | Decine per job | Migliaia per attempt |
| Storage | `events.db`, backup, nessuna cancellazione | `telemetry.db` + log JSONL, retention |
| Perdita | Si perde lo stato | Si perde dettaglio |

**Telemetria:** codice proprio, senza SDK di OpenTelemetry. Id di trace e span nel formato W3C Trace Context, così i dati si possono esportare verso strumenti OpenTelemetry se servirà. [Decisione]

**Cosa mostra la UI:** ogni nodo del grafo con stato, ruolo e profilo, giro, durata, token e costo, esito sintetico; il clic apre attempt (anche dei giri precedenti), timeline di comandi e file, artefatti, log grezzo; aggiornamento in tempo reale.

## 14. Configurazione

- **JSONC ovunque**, con commenti. Niente YAML, niente TOML.
- **Zod** è la fonte di verità: tipi TypeScript e JSON Schema derivati; `"$schema"` in testa a ogni file per l'autocompletamento.
- La UI modifica i file preservando i commenti (`jsonc-parser`).
- **Tutto nella directory di peCore** (sezione 21). Gli agenti non possono modificarla: recipe, ruoli e policy non sono raggiungibili dal runner.
- **Default e override:** impostazioni per factory, modificabili per singolo job dove indicato (canale delle domande, recipe, rete del nodo).
- Per ogni job si conservano il commit della configurazione e gli hash di recipe, ruoli, binding, policy, profili e knowledge base effettivi.

## 15. Runner ed esecuzione offline

- **Interfaccia:** il runner è un'interfaccia. Prima implementazione: container OCI. Podman rootless su Linux; su macOS gli stessi container in una VM Linux leggera (Podman machine, Colima, OrbStack o `container` di Apple). [Decisione]
- **Possibile seconda implementazione:** sandbox native (bubblewrap su Linux, Seatbelt su macOS) per i ruoli che non eseguono codice.

### Rete per nodo [Decisione]

Il runner non ha accesso diretto a internet. Esce solo dal proxy del daemon, che applica il livello scelto dall'utente per quel nodo:

| Livello | Cosa passa |
|---|---|
| `models` (default) | solo le API dei modelli dell'account del nodo |
| `allowlist` | API dei modelli più domini scelti dall'utente |
| `open` | internet libero |

### Nessun download non voluto

| Cosa | Come |
|---|---|
| Dipendenze | Immagine del progetto con dipendenze installate, taggata con l'hash del lockfile |
| Ricostruzione | Automatica quando il lockfile cambia su main; i job della factory aspettano; l'utente riceve un avviso [Decisione] |
| Pacchetti | Store di pnpm condiviso in sola lettura, `pnpm install --offline` |
| Servizi | Immagini scaricate una volta, versioni fissate, pull solo se mancante |
| Harness | Nell'immagine base, aggiornamento automatico disattivato |
| Codice | Mirror locale per repo, `git fetch` incrementale; il runner riceve una copia dal disco |
| Push e PR | Dal control plane, alla fine |

- **Servizi per gli integration test** avviati dal daemon **accanto** al runner, su una rete privata del job. Niente container annidati.
- **Un'immagine per progetto,** derivata dal devcontainer quando esiste.

## 16. Sicurezza

- Risorse da proteggere: token dei modelli, credenziali GitHub, host, home personale, altri repo, directory di peCore.
- Codice generato solo nel runner; credenziali GitHub solo nel control plane.
- Contenuti trattati come dati; permessi minimi per ruolo imposti dal runner.
- Push solo su `factory/*`; merge solo dal control plane; nessun deploy.
- Segreti cifrati nella directory di peCore, iniettati per attempt, mai nei prompt né nei log (sezione 21).
- Rete del runner secondo il livello del nodo, sempre attraverso il proxy.
- Adattatori AI delle source: traducono soltanto; le scritture verso la source le esegue peCore.
- API del daemon solo su `127.0.0.1`, token di autenticazione, controllo di `Origin` e `Host` (CSRF, DNS rebinding); accesso remoto solo via VPN privata.
- Licenze: zazencodes è GPLv3 (idee sì, codice no); Herdr è Apache 2.0 (riuso possibile con attribuzione).
- **Rischi accettati:** credenziali del modello nel runner quando il proxy non può sostituirle (sotto); prompt injection da codice e dipendenze del repo; lo spec writer legge insieme ticket e codice.

### Autenticazione [Proposta]

Tutte le credenziali stanno in `secrets.enc`, nel control plane. Il runner non ne riceve nessuna, tranne il caso 1b.

**1. Modelli (harness):**

- **a. Il proxy mette il token vero.** Nel runner il token è un segnaposto inutile (es. `CLAUDE_CODE_OAUTH_TOKEN=pecore-segnaposto`). L'harness lo manda nelle richieste come se fosse vero. Le richieste escono solo dal proxy di peCore, che sostituisce il segnaposto con il token vero. Chi ruba il token dal runner ottiene solo il segnaposto. Per leggere le richieste HTTPS, il proxy usa un certificato di peCore installato nell'immagine del runner. Vale per API key e per i token a lunga durata (es. `claude setup-token`).

  ```
  runner: "Bearer pecore-segnaposto" → proxy di peCore: "Bearer <token vero>" → api.anthropic.com
  ```
- **b. Credenziale nel runner.** Per gli harness in cui la sostituzione non funziona (es. login con file di sessione e refresh, come Codex con ChatGPT o agy), il file di credenziali viene montato in sola lettura per l'attempt. Rischio accettato, limitato da runner effimero e rete del nodo.
- **Login:** una volta sola sull'host, con `pecore auth login <account>`, che esegue il login dell'harness e salva il risultato in `secrets.enc`. Il daemon rinnova i token che scadono.
- Quale harness funziona con a e quale richiede b si prova in fase 0A.

**2. Servizi esterni (Atlassian, GitHub, Notion, ...):**

- Gli agenti non ricevono mai le credenziali. Le usa solo il daemon.
- Il daemon espone al runner un server MCP di peCore, raggiungibile da un socket montato nel runner. Il server offre solo gli strumenti permessi al nodo (es. leggi issue Jira, leggi pagina Confluence) e li esegue con le credenziali del daemon.
- **Permessi per nodo:** il nodo dichiara quali servizi e operazioni può usare. Default: sola lettura. Le scritture (commenti, cambi di stato) le esegue peCore come effetti esterni con intenzione ed esito (sezione 12).
- **Credenziali Atlassian:** API token o OAuth, configurati come account di tipo servizio in `accounts.jsonc`. L'orchestratore e l'adattatore Jira usano lo stesso account.

**Esempio: Atlassian con OAuth**

1. **Login, una volta:** `pecore auth login atlassian-work` apre il browser sulla pagina di consenso di Atlassian. Il daemon riceve i token OAuth, li salva in `secrets.enc` e li rinnova quando scadono.
2. **Uso nel job:** lo spec writer chiama `jira.read("PIN-123")` sul server MCP di peCore. Il daemon controlla il permesso del nodo, chiama il server MCP remoto di Atlassian con il token OAuth e restituisce solo il contenuto del ticket.
3. **Scritture:** passano dal daemon come effetti esterni, con eventi di intenzione ed esito.

```
runner: jira.read("PIN-123") → MCP di peCore (daemon, permessi del nodo) → token OAuth → MCP remoto di Atlassian
```

peCore fa da client verso il server MCP di Atlassian e ripropone al runner solo gli strumenti permessi. Così non serve scrivere codice per le API REST di Atlassian.

## 17. Source

Le source sono gli strumenti dell'orchestratore per l'intake. Ogni source espone quattro operazioni [Decisione]:

1. elenca i ticket nuovi;
2. leggi un ticket;
3. fai una domanda o scrivi un commento;
4. leggi le risposte.

Due tipi di adattatore:

- **In codice:** GitHub Issues (fase 1), cartella di file Markdown, Jira (fase 5).
- **AI generico:** per le altre source. Un agente con gli strumenti della source (es. un server MCP) esegue solo queste quattro operazioni e restituisce output strutturato e validato. Le scritture le esegue peCore.

Il canale delle domande ha un default per factory (la chat dell'orchestratore) e si può cambiare per job (es. domande sul ticket GitHub).

Le richieste scritte in chat non sono una source: l'orchestratore crea il work item direttamente.

## 18. UI

- Factory con stato e consumi
- Flusso del job in esecuzione con dettaglio al clic su ogni nodo
- Board dei job per stato
- Lista dei job finiti (`completed`, `cancelled`, `failed`), con esito e PR; da qui si cancellano, uno o più insieme. Cancellare toglie il job dalla lista e libera artefatti, log grezzi, telemetria e branch locali; la PR sul forge resta. Gli eventi di dominio restano, perché non si cancellano mai: il job risulta cancellato.
- Chat con l'orchestratore: testo, link, immagini, riferimenti a ticket; domande dei nodi; bozze di recipe
- Human approve: riassunto del lavoro, hunk ordinati per rischio, `safe` nascosti, con cosa fanno e perché sono rischiosi; Approve, Request changes con note, Reject
- Coda umana: domande, escalation, presa in mano
- Handbook: pagine, sorgenti (carica file, scegli cartella, aggiungi link, collega Confluence), avvio della recipe `handbook`
- Proposte per la knowledge base: importa, scarta, modifica
- Registro degli harness (versione, healthcheck, modelli per account, data della discovery)
- Tier, profili, limiti di concorrenza
- Editor grafico delle recipe: nodi e frecce trascinabili, impostazioni al clic sul nodo, solo grafi validi
- Editor di ruoli e binding
- Funzione di configurazione del progetto per i file protetti [Aperto]
- Source e loro stato
- Quote e costi per account

## 19. Belato: notifiche

| Situazione | Suono | Priorità |
|---|---|---|
| Job completato, PR pronta | belato breve | normale |
| Job in attesa dell'utente | belato insistente | alta |
| Proposta per la knowledge base | belato breve | bassa |
| Controllo fallito, nuovo giro | cane pastore che abbaia | bassa (solo UI) |
| Allarme sicurezza (es. accesso a `~/.ssh`) | ululato del lupo | critica |
| Gregge al lavoro | silenzio (campanaccio opzionale) | nessuna |

- **Modalità notte:** suoni spenti in una fascia oraria; solo le notifiche critiche passano.
- **Canali:** UI (suono + badge) e notifiche della PWA. Canali esterni come adattatori; quali, si decide dopo. [Aperto]

---

# PARTE II: SPECIFICA TECNICA

Tutto in questa parte è **[Proposta]** salvo dove indicato.

## 20. Stack e dipendenze

| Area | Scelta | Motivo |
|---|---|---|
| Runtime | Node.js LTS | Stack dell'utente |
| Linguaggio | TypeScript strict | Decisione |
| Monorepo | pnpm workspace | Store condiviso, offline |
| Validazione | Zod (con generazione JSON Schema nativa) | Decisione |
| SQLite | `better-sqlite3` | Sincrono, maturo, transazioni semplici |
| API HTTP + WebSocket | Fastify + `@fastify/websocket` | Leggero, schema-first |
| JSONC | `jsonc-parser` | Lettura e modifica preservando i commenti |
| Id | ULID | Unici e ordinabili |
| Cifratura dei segreti | `node:crypto` (scrypt + AES-256-GCM) | Nessuna dipendenza |
| Portachiavi | CLI di sistema (`secret-tool` su Linux, `security` su macOS) | Nessuna dipendenza |
| Telemetria | codice proprio, id W3C | Decisione |
| Test | Vitest + fast-check | Unit e property-based |
| UI | React + Vite | Esperienza dell'utente |

Regola: **poche dipendenze**, nessuna per funzioni banali. Ogni nuova dipendenza va motivata.

## 21. Directory di peCore

Un'unica directory contiene tutto. Percorso configurabile con `PECORE_HOME` (default proposto `~/.pecore`). Si può copiare o sincronizzare su un altro computer; peCore gira su un computer alla volta. [Decisione]

**SQLite per lo stato, file per il resto.** In SQLite: eventi, proiezioni, chat, telemetria. Su file: handbook, sorgenti, recipe, ruoli, configurazione, artefatti, log grezzi. Gli agenti leggono file montati nel runner; l'utente modifica i file con il suo editor e li può versionare con git. [Decisione]

```
$PECORE_HOME/
  config/
    daemon.jsonc                    porta, retention, modalità notte, limiti di concorrenza
    policy.jsonc                    regole globali, budget
    accounts.jsonc                  account: provider, tipo, riferimento al segreto
    profiles.jsonc                  agent profile
    tiers.jsonc                     tier
    prices.jsonc                    prezzi per modello, per cost_usd_equivalent
    harnesses/<name>/manifest.jsonc manifest dei plugin
    sources/<source-id>.jsonc       configurazione delle source
    roles/<name>.jsonc              ruoli (predefiniti e personalizzati)
    roles/<name>.md                 template del prompt
    recipes/<name>.jsonc            recipe
    recipe-drafts/<name>.jsonc      bozze proposte dall'orchestratore
  factories/<factory-id>/
    factory.jsonc                   repo, source, recipe di default, comandi dei controlli, file protetti, limiti
    knowledge/**.md                 knowledge base (handbook)
    knowledge-proposals/            proposte in attesa
    handbook-sources/               sorgenti dell'handbook: file caricati e sources.jsonc con link e riferimenti
  secrets.enc                       segreti cifrati
  data/
    events.db                       eventi di dominio + proiezioni
    telemetry.db                    span, metriche, indice dei log
    artifacts/<job-id>/<node-run>/<attempt-id>/
        prompt.md                   prompt effettivo inviato
        context/                    file di contesto generati
        output.json                 risposta strutturata
        check.log                   output del controllo (se nodo di controllo)
        diff.patch                  diff prodotto (se builder)
        proposals/                  pagine proposte per la knowledge base
    logs/<attempt-id>.jsonl.zst     output grezzo dell'harness, compresso
    mirrors/<host>/<owner>/<repo>.git
    backups/events-<data>.db        backup giornalieri
  run/                              locale alla macchina, non si copia
    daemon.pid
    api-token                       token dell'API locale (permessi 0600)
    runtime/                        worktree temporanei, socket del proxy
```

- **Segreti:** `secrets.enc` cifrato con una chiave derivata da una password. La password sta nel portachiavi di ogni computer; il daemon si sblocca da solo al login. Su un computer nuovo si inserisce una volta. [Decisione]
- **Immagini dei container:** stanno nello storage di Podman, non nella directory. Su un computer nuovo si ricostruiscono.
- **Copia:** si copia a daemon fermo, oppure dai backup, perché SQLite in modalità WAL non va copiato mentre scrive.

### Salvataggio e condivisione [Proposta]

- **Repo git:** `PECORE_HOME` è un repo git, salvato su un repo privato (es. GitHub). Dentro: `config/` e `factories/` (recipe, ruoli, configurazione, handbook). Fuori, con `.gitignore`: `data/`, `run/`, `secrets.enc`.
- **Commit automatico:** ogni modifica salvata dalla UI diventa un commit con un messaggio leggibile (es. `recipe feature: aggiunto auto_approve_if`). Push manuale o automatico, a scelta.
- **Storia:** si vede e si ripristina ogni versione di recipe, ruoli e handbook. Ogni job registra il commit della configurazione con cui è girato.
- **Altro computer:** `git clone`, segreti inseriti a mano, backup di `data/` se servono i job passati.
- **File grandi:** PDF e immagini delle sorgenti dell'handbook con Git LFS.
- **Condivisione con altri:** `pecore recipe import <url|file>` e `pecore role import <url|file>`. La recipe importata viene validata; i ruoli mancanti vengono segnalati. Nessun segreto passa mai dal repo.

### Recipe e ruoli predefiniti

Inclusi nei pacchetti `@pecore/recipes` e `@pecore/roles`, copiati in `config/` alla prima esecuzione: recipe `feature`, `bugfix` (fase 1), `handbook` (fase 2), `cleanup`, `dependency-diet` (fase 4); ruoli `orchestrator`, `spec-writer`, `tests`, `builder`, `code-reviewer`, `security-reviewer`, `ui-reviewer`, `ux-reviewer`, `approver`.

## 22. Storage: `events.db`

SQLite in modalità WAL, `synchronous=NORMAL`, `foreign_keys=ON`. Ogni comando scrive eventi e aggiorna le proiezioni nella stessa transazione. Le proiezioni si ricostruiscono svuotandole e rileggendo `events` dall'inizio.

### Tabella degli eventi

```sql
CREATE TABLE events (
  position      INTEGER PRIMARY KEY AUTOINCREMENT,
  id            TEXT    NOT NULL UNIQUE,
  stream        TEXT    NOT NULL,
  sequence      INTEGER NOT NULL,
  type          TEXT    NOT NULL,
  time          TEXT    NOT NULL,
  source        TEXT    NOT NULL,
  traceparent   TEXT,
  causation_id  TEXT,
  actor_kind    TEXT    NOT NULL,
  actor_id      TEXT,
  data          TEXT    NOT NULL,
  UNIQUE (stream, sequence)
);
CREATE INDEX events_by_type ON events(type);
```

Stream: `job:<id>`, `conversation:<id>`, `factory:<id>`, `account:<id>`, `harness:<name>`, `workitem:<source>:<external_id>`, `kb:<factory-id>`.

### Identità dei node run

Un node run si identifica con l'id del nodo nella recipe e il giro: es. `code#2`, `types#2`, `approve#1`.

### Proiezioni

```sql
CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  factory_id      TEXT NOT NULL,
  recipe          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  title           TEXT NOT NULL,
  state           TEXT NOT NULL,
  outcome         TEXT,                   -- nodo ed esito che hanno chiuso il job, es. 'pr:merged'
  failure_reason  TEXT,
  risk            TEXT,                   -- safe|risky, se la recipe ha un approver
  branch          TEXT,
  head_sha        TEXT,
  pr_number       INTEGER,
  trace_id        TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT                    -- cancellato dalla lista dei job finiti
);

CREATE TABLE node_runs (
  id              TEXT PRIMARY KEY,       -- '<job-id>/<nodo>#<giro>'
  job_id          TEXT NOT NULL REFERENCES jobs(id),
  node            TEXT NOT NULL,          -- id del nodo nella recipe
  type            TEXT NOT NULL,          -- agent|diff_guard|secret_scan|format_check|lint|typecheck|build|test_run|script|policy_gate|auto_approve_if|human_approve|pr
  role            TEXT,                   -- per i nodi agent
  round           INTEGER NOT NULL,
  state           TEXT NOT NULL,          -- pending|running|completed|failed|waiting_human|skipped|cancelled
  outcome         TEXT,                   -- esito del nodo, es. 'passed', 'changes', 'safe'
  span_id         TEXT NOT NULL,
  started_at      TEXT,
  ended_at        TEXT
);

CREATE TABLE attempts (
  id                  TEXT PRIMARY KEY,
  job_id              TEXT NOT NULL REFERENCES jobs(id),
  node_run_id         TEXT NOT NULL REFERENCES node_runs(id),
  number              INTEGER NOT NULL,
  profile             TEXT,
  harness             TEXT,
  harness_version     TEXT,
  model               TEXT,
  effort              TEXT,
  account_id          TEXT,
  session_id          TEXT,               -- sessione dell'harness, per la ripresa del builder
  start_sha           TEXT,
  end_sha             TEXT,
  state               TEXT NOT NULL,      -- running|succeeded|failed|cancelled
  failure_reason      TEXT,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  cached_tokens       INTEGER,
  cost_usd            REAL,               -- API effettivo
  cost_usd_equivalent REAL,               -- su subscription, da prices.jsonc
  log_path            TEXT,
  artifact_dir        TEXT,
  started_at          TEXT NOT NULL,
  ended_at            TEXT
);

CREATE TABLE human_queue (
  id              TEXT PRIMARY KEY,
  job_id          TEXT,
  kind            TEXT NOT NULL,          -- question|human_approve|round_limit|kb_proposal
  question        TEXT NOT NULL,
  context_ref     TEXT,                   -- artefatto da mostrare (es. hunk classificati)
  head_sha        TEXT,
  state           TEXT NOT NULL,          -- open|answered|expired
  action          TEXT,                   -- approve|request_changes|reject|answer|import|discard
  answer          TEXT,
  created_at      TEXT NOT NULL,
  answered_at     TEXT
);

CREATE TABLE work_items (
  source_id       TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  job_id          TEXT,
  first_seen_at   TEXT NOT NULL,
  PRIMARY KEY (source_id, external_id)
);

CREATE TABLE pending_effects (
  intent_event_id TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL,
  kind            TEXT NOT NULL,          -- push|open_pr|close_pr|comment|merge|writeback
  idempotency_key TEXT NOT NULL UNIQUE,   -- es. 'open_pr:<repo>:<branch>'
  state           TEXT NOT NULL,          -- requested|completed|failed
  result          TEXT
);

CREATE TABLE usage_daily (
  day                 TEXT NOT NULL,
  account_id          TEXT NOT NULL,
  input_tokens        INTEGER NOT NULL,
  output_tokens       INTEGER NOT NULL,
  cost_usd            REAL NOT NULL,
  cost_usd_equivalent REAL NOT NULL,
  PRIMARY KEY (day, account_id)
);

CREATE TABLE quota_leases (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL,
  provider        TEXT NOT NULL,
  attempt_id      TEXT NOT NULL,
  acquired_at     TEXT NOT NULL,
  released_at     TEXT
);
```

### Backup

- Ogni notte `VACUUM INTO` verso `data/backups/events-<data>.db`; si conservano gli ultimi 14.
- Verifica: apertura del backup e `PRAGMA integrity_check`.
- `events.db` non ha retention: gli eventi non si cancellano, nemmeno quando l'utente cancella un job.

## 23. Storage: telemetria

### `telemetry.db`

```sql
CREATE TABLE spans (
  trace_id        TEXT NOT NULL,
  span_id         TEXT PRIMARY KEY,
  parent_span_id  TEXT,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,          -- job|node|attempt|tool|command
  job_id          TEXT,
  attempt_id      TEXT,
  start_ns        INTEGER NOT NULL,
  end_ns          INTEGER,
  status          TEXT,                   -- ok|error
  attributes      TEXT NOT NULL
);
CREATE INDEX spans_by_trace   ON spans(trace_id);
CREATE INDEX spans_by_attempt ON spans(attempt_id);

CREATE TABLE log_index (
  attempt_id      TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  ts              TEXT NOT NULL,
  type            TEXT NOT NULL,          -- message|tool.called|file.changed|usage|error|final
  summary         TEXT NOT NULL,
  raw_offset      INTEGER NOT NULL,
  span_id         TEXT,
  PRIMARY KEY (attempt_id, seq)
);

CREATE TABLE metrics (
  name            TEXT NOT NULL,
  ts              TEXT NOT NULL,
  value           REAL NOT NULL,
  attributes      TEXT NOT NULL
);
```

### Log grezzi

- `data/logs/<attempt-id>.jsonl.zst`: output originale dell'harness, compresso.
- L'adapter estrae gli eventi normalizzati in `log_index` con il puntatore alla riga originale.

### Gerarchia degli span

```
job                              trace_id = jobs.trace_id
└─ node (es. builder#2)          span_id = node_runs.span_id
   └─ attempt
      ├─ tool.call (es. bash: vitest run)
      └─ tool.call (es. write: src/x.ts)
```

Il `traceparent` dello span dell'attempt passa al runner come variabile d'ambiente `TRACEPARENT`.

## 24. Catalogo degli eventi di dominio (fase 1)

Formato del tipo: `<area>.<fatto>.v<versione>`.

| Tipo | Stream | Dati principali |
|---|---|---|
| `workitem.discovered.v1` | workitem | source, external_id, url, titolo |
| `chat.message_posted.v1` | conversation | autore (utente o orchestratore), testo, allegati |
| `recipe.selected.v1` | conversation | work item, factory, recipe, motivo |
| `recipe.draft_proposed.v1` | conversation | nome, file della bozza |
| `recipe.saved.v1` | factory | nome, hash |
| `job.created.v1` | job | factory, recipe, work item, conversazione, trace_id |
| `node.started.v1` | job | node, type, role, round, span_id |
| `node.completed.v1` | job | node, round, esito, head_sha, artefatto dell'output (spec e subtask, rilievi, hunk classificati, log del controllo) |
| `node.failed.v1` | job | node, round, reason |
| `node.skipped.v1` | job | node, round, motivo (es. opzionale non scelto) |
| `attempt.started.v1` | job | attempt_id, profile, harness, versione, modello, effort, account, start_sha, session_id |
| `attempt.fallback_selected.v1` | job | da profilo, a profilo, motivo |
| `attempt.completed.v1` | job | end_sha, usage, costo, artefatti |
| `attempt.failed.v1` | job | reason (tipizzato), dettagli |
| `human.requested.v1` | job | kind (domanda, human approve, limite di giri), domanda, canale, head_sha |
| `human.answered.v1` | job | azione, risposta, chi |
| `human.takeover_started.v1` | job | branch |
| `human.takeover_returned.v1` | job | head_sha |
| `approvals.invalidated.v1` | job | vecchio head_sha, nuovo head_sha |
| `push.requested.v1` / `push.completed.v1` | job | branch, sha |
| `pr.open.requested.v1` / `pr.opened.v1` | job | repo, branch, numero, approvazioni esterne richieste |
| `writeback.requested.v1` / `writeback.completed.v1` | job | source, tipo |
| `merge.requested.v1` / `merge.completed.v1` | job | head_sha |
| `job.completed.v1` | job | nodo ed esito finali, PR |
| `job.failed.v1` | job | reason |
| `job.cancelled.v1` | job | chi, motivo |
| `job.deleted.v1` | job | chi; artefatti, log e telemetria liberati |
| `kb.proposal_submitted.v1` | kb | job, attempt, file |
| `kb.proposal_resolved.v1` | kb | azione (import/discard/edit), ruoli assegnati |
| `image.rebuild_started.v1` / `image.rebuild_completed.v1` | factory | hash del lockfile |
| `harness.discovered.v1` | harness | versione, modelli per account, data |
| `harness.health_changed.v1` | harness | stato, motivo |

Ogni tipo ha uno schema Zod in `@pecore/core/events`, riuniti in una discriminated union su `type`. Upcasting per le versioni precedenti.

### Envelope

Formato CloudEvents. Le estensioni hanno solo valori semplici, come richiede la specifica.

```jsonc
{
  "specversion": "1.0",
  "id": "01JD3Q8M5K7Q2W9R4T6Y8U0I1O",
  "type": "node.completed.v1",
  "source": "daemon/engine",
  "time": "2026-11-17T15:20:11Z",
  "subject": "job:01JD3P0A1B2C3D4E5F6G7H8J9K",
  "sequence": 17,
  "traceparent": "00-<trace>-<span>-01",
  "causationid": "01JD3Q7Z2X4C6V8B0N2M4L6K8J",
  "actorkind": "system",
  "data": { "node": "typecheck", "round": 2, "outcome": "passed", "headSha": "a1b2c3d", "artifact": { "path": "...", "sha256": "..." } }
}
```

Corrispondenza con la tabella: `subject` = `stream`, `causationid` = `causation_id`, `actorkind`/`actorid` = `actor_kind`/`actor_id`.

Regole: payload piccoli, riferimenti agli artefatti, mai segreti, mai contenuti non attendibili.

## 25. Formati di configurazione

### `accounts.jsonc`

```jsonc
{
  "$schema": "https://pecore.local/schemas/accounts.json",
  "accounts": [
    {
      "id": "anthropic-max",
      "provider": "anthropic",
      "kind": "subscription",
      "harnesses": ["claude-code"],          // la subscription Claude vale solo in Claude Code
      "secretRef": "anthropic-max",          // chiave dentro secrets.enc
      "maxParallel": 2,
      "interactiveReservePct": 20
    },
    {
      "id": "openai-plus",
      "provider": "openai",
      "kind": "subscription",
      "harnesses": ["codex"],
      "secretRef": "openai-plus",
      "maxParallel": 1
    },
    {
      "id": "atlassian-work",
      "provider": "atlassian",
      "kind": "service",                     // usato solo dal daemon, mai nel runner
      "site": "<tenant>.atlassian.net",
      "auth": "oauth",                       // oppure "api-token"
      "mcp": "<url del server MCP remoto di Atlassian>",
      "secretRef": "atlassian-work"
    }
  ]
}
```

### `daemon.jsonc` (limiti di concorrenza)

```jsonc
{
  "port": 7457,
  "limits": {
    "maxJobs": 3,
    "maxAgents": 4,
    "perProvider": { "anthropic": 2, "openai": 1 }
  },
  "night": { "from": "23:00", "to": "07:30" }
}
```

### `profiles.jsonc` e `tiers.jsonc`

```jsonc
{
  "profiles": {
    "fable-5.2-high":     { "harness": "claude-code", "model": "claude-fable-5-2", "effort": "high",   "account": "anthropic-max", "timeoutMin": 30 },
    "opus-5.5-low":       { "harness": "claude-code", "model": "claude-opus-5-5",  "effort": "low",    "account": "anthropic-max", "timeoutMin": 30 },
    "gpt-6.1-sol-medium": { "harness": "codex",       "model": "gpt-6.1-sol",      "effort": "medium", "account": "openai-plus",   "timeoutMin": 30 }
  }
}
```

```jsonc
{
  "tiers": {
    "frontier": ["fable-5.2-high"],
    "strong":   ["opus-5.5-low", "gpt-6.1-sol-medium"],
    "standard": [],
    "cheap":    []
  },
  "degrade": { "builder": false }
}
```

### Factory

```jsonc
{
  "id": "sandbox",
  "repo": { "forge": "github", "owner": "<owner>", "name": "<repo>" },
  "source": { "id": "sandbox-issues", "questionsChannel": "github" },
  "defaultRecipe": "feature",
  "checks": {
    "diff_guard":   { "maxFiles": 40, "maxLines": 1500 },
    "secret_scan":  { "model": "<modello locale>" },
    "format_check": ["prettier", "--check", "."],
    "lint":         ["eslint", "--max-warnings=0", "."],
    "typecheck":    ["tsc", "-b", "--noEmit"],
    "build":        ["tsc", "-b"],
    "test_run":     { "unit": ["vitest", "run", "--project", "unit"], "integration": ["vitest", "run", "--project", "integration"] }
  },
  "policy": {
    "protectedFiles": ["eslint.config.js", "tsconfig.base.json", "vitest.workspace.ts"],
    "publicApiUnchanged": ["oasdiff", "breaking", "main:openapi.yaml", "openapi.yaml", "--fail-on", "ERR"],
    "rules": []                               // altri comandi: passa se exit code 0
  },
  "limits": { "maxConcurrentJobs": 1, "maxWallMinutes": 60 }
}
```

### Recipe

Grafo di nodi e frecce. L'editor grafico della UI legge e scrive questo file preservando i commenti.

```jsonc
{
  "$schema": "https://pecore.local/schemas/recipe.json",
  "recipe": "feature",
  "description": "Nuova funzionalità su codice esistente: spec, test, codice, review, approvazione.",
  "start": "spec",
  "nodes": {
    "spec":     { "type": "agent", "role": "spec-writer", "tier": "frontier", "instructions": "recipes/feature.md" },
    "tests":    { "type": "agent", "role": "tests", "tier": "strong", "perSubtask": true },
    "code":     { "type": "agent", "role": "builder", "profiles": ["opus-5.5-low", "gpt-6.1-sol-medium"], "perSubtask": true, "network": "models", "knowledge": ["conventions/**", "architecture/**"] },
    "guard":    { "type": "diff_guard" },
    "secrets":  { "type": "secret_scan" },
    "format":   { "type": "format_check" },
    "lint":     { "type": "lint" },
    "types":    { "type": "typecheck" },
    "build":    { "type": "build" },
    "test":     { "type": "test_run", "suites": ["unit", "integration"] },
    "review":   { "type": "agent", "role": "code-reviewer", "tier": "strong", "providerDiffersFrom": "code" },
    "security": { "type": "agent", "role": "security-reviewer", "tier": "strong", "optional": true },
    "approve":  { "type": "agent", "role": "approver", "tier": "frontier" },
    "policy":   { "type": "policy_gate" },
    "auto":     { "type": "auto_approve_if", "maxFiles": 10, "maxLines": 300, "checksGreen": true, "reviewClean": true, "noRiskyHunks": true },
    "human":    { "type": "human_approve" },
    "pr":       { "type": "pr", "merge": "auto" }
  },
  "edges": [
    { "from": "spec",     "on": "accepted",      "to": "tests" },
    { "from": "tests",    "on": "done",          "to": "code" },
    { "from": "code",     "on": "done",          "to": "guard" },
    { "from": "guard",    "on": "passed",        "to": "secrets" },
    { "from": "secrets",  "on": "passed",        "to": "format" },
    { "from": "format",   "on": "passed",        "to": "lint" },
    { "from": "lint",     "on": "passed",        "to": "types" },
    { "from": "types",    "on": "passed",        "to": "build" },
    { "from": "build",    "on": "passed",        "to": "test" },
    { "from": "secrets",  "on": "failed",        "to": "code", "maxRounds": 3 },
    { "from": "format",   "on": "failed",        "to": "code", "maxRounds": 3 },
    { "from": "lint",     "on": "failed",        "to": "code", "maxRounds": 3 },
    { "from": "types",    "on": "failed",        "to": "code", "maxRounds": 3 },
    { "from": "build",    "on": "failed",        "to": "code", "maxRounds": 3 },
    { "from": "test",     "on": "failed",        "to": "code", "maxRounds": 3 },
    { "from": "test",     "on": "passed",        "to": "review" },
    { "from": "test",     "on": "passed",        "to": "security" },
    { "from": "review",   "on": "changes_code",  "to": "code", "maxRounds": 3 },
    { "from": "review",   "on": "changes_tests", "to": "tests", "maxRounds": 3 },
    { "from": "security", "on": "changes_code",  "to": "code", "maxRounds": 3 },
    { "from": "review",   "on": "approve",       "to": "approve" },
    { "from": "security", "on": "approve",       "to": "approve" },
    { "from": "approve",  "on": "done",          "to": "policy" },
    { "from": "policy",   "on": "passed",        "to": "auto" },
    { "from": "policy",   "on": "failed",        "to": "code", "maxRounds": 3 },
    { "from": "auto",     "on": "passed",        "to": "pr" },
    { "from": "auto",     "on": "failed",        "to": "human" },
    { "from": "human",    "on": "approve",       "to": "pr" },
    { "from": "human",    "on": "changes",       "to": "code" }
  ]
}
```

`description` serve all'orchestratore per scegliere la recipe. `profiles` elenca gli agenti tra cui lo spec writer sceglie per ogni subtask. Esiti senza freccia (`spec:rejected`, `guard:failed`, `human:reject`) chiudono il job, come le uscite (`pr:merged`, `pr:open`). La recipe vuota è `{ "recipe": "empty", "nodes": {}, "edges": [] }`.

### Ruolo

```jsonc
{
  "role": "ddd-reviewer",
  "version": 1,
  "kind": "reviewer",
  "promptTemplate": "roles/ddd-reviewer.md",
  "permissions": "read-only",
  "network": "models",
  "inputs": ["spec.md", "diff.patch", "check.log"],
  "services": { "atlassian-work": ["jira.read", "confluence.read"] },   // strumenti MCP di peCore permessi
  "knowledge": ["architecture/**", "domain/**"],
  "output": { "file": "review.json", "schema": "ReviewOutput" },
  "contextBudgetTokens": 60000
}
```

Un nodo della recipe può sovrascrivere `knowledge` e `network` del suo ruolo. Gli esiti di un ruolo dipendono dal suo `kind` (es. `reviewer`: `approve`, `changes`); un ruolo creato dall'utente può dichiararne di propri.

### Manifest dell'adapter generico

```jsonc
{
  "name": "example-cli",
  "version": { "command": ["example", "--version"], "pattern": "(\\d+\\.\\d+\\.\\d+)", "tested": ">=2.1 <3" },
  "run": ["example", "-p", "{prompt}", "--model", "{model}", "--format", "jsonl"],
  "level": "L2",
  "events": [
    { "match": { "type": "tool_use" }, "emit": "tool.called", "fields": { "name": "$.tool", "input": "$.args" } },
    { "match": { "type": "usage" }, "emit": "usage", "fields": { "input": "$.in", "output": "$.out" } }
  ],
  "success": { "exitCode": 0, "requireEvent": "run.completed" },
  "models": { "command": ["example", "models", "--json"], "path": "$[*].id" },
  "effort": ["low", "medium", "high"],
  "contextFiles": ["AGENTS.md"],
  "authCheck": ["example", "auth", "status"],
  "auth": { "env": { "EXAMPLE_TOKEN": "{secret}" } }
}
```

### Policy

```jsonc
{
  "budgets": { "perJobUsd": 5, "perDayUsd": 20 }
}
```

## 26. Interfacce TypeScript principali

```ts
// Harness
interface HarnessAdapter {
  manifest(): HarnessManifest;
  healthcheck(account: Account): Promise<HealthReport>;
  discoverModels(account: Account): Promise<ModelCatalog>;
  start(req: AttemptRequest): AttemptHandle;
}
interface AttemptRequest {
  attemptId: string;
  workdir: string;
  promptFile: string;
  profile: AgentProfile;
  resumeSessionId?: string;
  outputSchema?: JsonSchema;
  traceparent: string;
}
interface AttemptHandle {
  events(): AsyncIterable<NormalizedEvent>;
  cancel(reason: string): Promise<void>;
  result(): Promise<AttemptResult>;
}
type NormalizedEvent =
  | { type: "run.started"; ts: string; sessionId?: string }
  | { type: "message"; ts: string; text: string }
  | { type: "tool.called"; ts: string; name: string; input: unknown }
  | { type: "file.changed"; ts: string; path: string }
  | { type: "usage"; ts: string; input: number; output: number; cached?: number }
  | { type: "run.completed"; ts: string; final?: unknown }
  | { type: "run.failed"; ts: string; reason: FailureReason; detail?: string };

// Source
interface SourceAdapter {
  list(since?: string): Promise<WorkItemRef[]>;
  read(ref: WorkItemRef): Promise<WorkItem>;
  post(ref: WorkItemRef, message: SourceMessage): Promise<void>;
  replies(ref: WorkItemRef, since?: string): Promise<SourceReply[]>;
}

// Forge
interface Forge {
  syncMirror(repo: RepoRef): Promise<void>;
  push(repo: RepoRef, branch: string, sha: string): Promise<void>;
  findOpenPr(repo: RepoRef, branch: string): Promise<PrRef | null>;
  openPr(repo: RepoRef, req: OpenPrRequest): Promise<PrRef>;
  prStatus(pr: PrRef): Promise<PrStatus>;   // approvazioni richieste, CI, mergeable
  closePr(pr: PrRef): Promise<void>;
  comment(target: PrRef | IssueRef, marker: string, body: string): Promise<void>;
  merge(pr: PrRef, expectedHeadSha: string): Promise<void>;
}

// Runner
interface Runner {
  ensureImage(project: ProjectRef, lockfileHash: string): Promise<ImageRef>;
  startServices(job: JobRef, spec: ServicesSpec): Promise<ServicesHandle>;
  run(spec: RunnerSpec): Promise<RunnerHandle>;   // repo copiato, knowledge montata, rete del nodo, token segnaposto o credenziale montata, socket MCP di peCore
}

// Motore
interface NodeExecutor {
  execute(run: NodeRun, ctx: ExecutionContext): Promise<NodeOutcome>;
}
```

## 27. Macchina a stati del job

Lo stato del job è generico; dove si trova nel grafo lo dicono i node run.

```
queued → running
running → waiting_human → running
running → takeover → running
running → completed
qualsiasi non finale → cancelled
running → failed
```

Stati finali: `completed` (con nodo ed esito in `jobs.outcome`), `cancelled`, `failed`.

| Da | A | Evento |
|---|---|---|
| `queued` | `running` | `node.started` (primo nodo) |
| `queued` | `completed` | `job.completed` (recipe vuota) |
| `running` | `waiting_human` | `human.requested` (domanda, human approve, limite di giri) |
| `waiting_human` | `running` | `human.answered` o risposta sulla source |
| `running` | `takeover` | `human.takeover_started` |
| `takeover` | `running` | `human.takeover_returned` |
| `running` | `completed` | `job.completed` (esito senza freccia) |
| qualsiasi non finale | `cancelled` | `job.cancelled` |
| `running` | `failed` | `job.failed` |

## 28. Ruoli e contesto

### Ruoli

Ogni ruolo ha: template del prompt (Markdown con segnaposto), permessi, livello di rete, input attesi, file della knowledge base, file e schema di output, budget di contesto, versione. L'hash del ruolo entra nell'evidence bundle. Ogni ruolo è personalizzabile, anche quelli predefiniti; l'utente può crearne di nuovi, in particolare reviewer specialisti. [Decisione]

### Contesto per ruolo

| Ruolo | Riceve | Non riceve |
|---|---|---|
| orchestratore | messaggi dell'utente, allegati, contenuto dei link, ticket letti dalle source, factory, recipe con descrizione | segreti, repo, permessi di scrittura |
| spec-writer | ticket (come dato citato), repo in sola lettura, knowledge base del ruolo, istruzioni del nodo, nodi opzionali e profili permessi dalla recipe | permessi di scrittura |
| tests | spec (del subtask), knowledge base del ruolo, rilievi dei reviewer sui test | codice del builder in corso |
| builder | spec (del subtask), test scritti, knowledge base del ruolo, log del controllo fallito, rilievi dei reviewer, note dell'utente; riprende la propria sessione | conversazioni dei reviewer |
| code-reviewer | spec, diff, log dei controlli, test esistenti modificati o cancellati, knowledge base del ruolo | conversazione del builder |
| reviewer specialista | spec, diff, knowledge base del ruolo | conversazione del builder |
| approver | spec, risultati dei controlli, verdetti dei reviewer, diff | conversazioni |

Ogni contesto ha un budget di token; il control plane taglia per priorità (spec e feedback prima, poi knowledge base, poi file).

### Formato della spec

```markdown
## Criteri di accettazione
- **AC-1** Given un rimborso richiesto dopo 14 giorni lavorativi,
  When l'utente lo invia, Then la richiesta è rifiutata con codice REFUND_EXPIRED.

## Cosa devono verificare i test
- Unit: rifiuto oltre 14 giorni lavorativi, accettazione al giorno 14.
- Integration: endpoint di rimborso con richiesta scaduta.

## Subtask
- **S-1** Calcolo dei giorni lavorativi (AC-1). Profilo: opus-5.5-low.
- **S-2** Endpoint di rimborso (AC-1). Profilo: gpt-6.1-sol-medium.

## Reviewer
- security-reviewer
```

Senza la sezione Subtask il task è uno solo.

## 29. Passaggio di mano

1. L'utente sceglie "prendi in mano" su un job (UI o CLI).
2. Evento `human.takeover_started`; il daemon crea il branch locale dal mirror e indica dove lavorare.
3. L'utente corregge a mano e fa commit.
4. "Restituisci": evento `human.takeover_returned` con il nuovo `head_sha`; le approvazioni precedenti decadono; il job riparte dal nodo scelto dall'utente.

## 30. Ingresso di un nuovo progetto

Checklist di prontezza (comando `pecore factory check <id>`):

- comandi dei controlli configurati, verdi su main, sotto i 3-5 minuti in tutto
- recipe della factory valide
- knowledge base con almeno una pagina assegnata a ogni ruolo delle recipe
- file protetti configurati, `tsconfig.base.json` presente
- branch protection attiva sul forge
- immagine offline costruita e servizi definiti
- source configurata e prova di `list()` riuscita
- binding validi rispetto a policy e account

## 31. CLI (fase 1)

```
pecore daemon start | stop | status
pecore secrets set <ref> | unlock
pecore auth login <account> | status
pecore factory list | show <id> | check <id>
pecore image build <factory>
pecore harness list | doctor | discover
pecore job run <factory> <work-item-ref> [--recipe <nome>]
pecore job list [--done] | show <id> | logs <id> [--attempt <id>] | cancel <id> | delete <id>...
pecore human list
pecore human approve <id> | reject <id> | changes <id> "<note>" | answer <id> "<testo>"
pecore kb proposals | import <id> --roles <ruoli> | discard <id>
pecore takeover <job> | return <job>
pecore recipe validate <file> | import <url|file>
pecore role import <url|file>
pecore events tail [--job <id>]
```

## 32. API locale (fase 1)

```
GET    /api/factories
GET    /api/jobs?state=&factory=
GET    /api/jobs/:id                      stato, blocchi, attempt
GET    /api/jobs/:id/graph                grafo della recipe con stato dei nodi
GET    /api/attempts/:id/timeline         da log_index
GET    /api/attempts/:id/log              log grezzo (streaming)
GET    /api/artifacts/:path
POST   /api/jobs                          avvia un job
GET    /api/conversations/:id             messaggi della chat con l'orchestratore
POST   /api/conversations/:id/messages    messaggio dell'utente (testo, link, immagini)
POST   /api/jobs/:id/cancel
DELETE /api/jobs/:id                      solo job finiti: toglie dalla lista e libera artefatti e log
GET    /api/human
POST   /api/human/:id                     azione: approve|request_changes|reject|answer
GET    /api/kb/proposals
POST   /api/kb/proposals/:id              azione: import|discard
GET    /api/harnesses
POST   /api/harnesses/:name/discover
GET    /api/usage?from=&to=
WS     /api/stream                        eventi di dominio e aggiornamenti della timeline
```

Autenticazione: header con il token di `$PECORE_HOME/run/api-token`; controllo di `Origin` e `Host`.

## 33. Struttura del codice

```
pecore/
  packages/
    core/            dominio: tipi, schemi Zod, eventi, macchina a stati
    store/           SQLite: eventi, proiezioni, migrazioni, backup
    engine/          esecuzione dei grafi, nodi, validazione delle recipe, tier
    orchestrator/    chat, scelta della recipe, bozze (fase 2)
    scheduler/       quote, lease, limiti di concorrenza
    telemetry/       span, log_index, metriche
    secrets/         cifratura, portachiavi
    runner-oci/      Podman, immagini, servizi, proxy di rete
    forge-github/    mirror, push, PR, merge
    knowledge/       selezione, montaggio, proposte
    sources/
      github-issues/
      local-folder/
      chat/          (fase 2)
      jira/          (fase 5)
      generic-ai/    (fase 4)
    harnesses/
      claude-code/
      codex/
      agy/           (fase 4)
      opencode/      (fase 4)
      pi/            (fase 4)
      copilot/       (fase 4)
      generic/       (fase 4)
    recipes/         recipe predefinite
    roles/           ruoli e template predefiniti
    daemon/          processo principale, API, WebSocket, Belato
    cli/
  apps/
    ui/              React + Vite
```

## 34. Perimetro della fase 1

**Ordine di costruzione [Decisione]:** prima un flusso completo minimo, poi il resto.

1. **Flusso minimo:** una issue attraversa la recipe `feature` ridotta (spec writer → tests → builder in container → controlli → code review → approver → PR, senza subtask), sopra l'event store fin dall'inizio, con API HTTP e CLI.
2. **Poi:** proxy di rete per nodo, ripresa della sessione del builder, nodi opzionali, frecce parallele, subtask in parallelo, `policy_gate`, `auto_approve_if`, `human_approve` da CLI con riassunto e hunk, `merge: auto`, riconciliazione al riavvio, cancellazione, agenti bloccati, telemetria, secondo harness per la code review, ricostruzione automatica dell'immagine, segreti cifrati.

**Dentro:**

- daemon headless con API HTTP e CLI
- `events.db` con eventi, proiezioni, backup; telemetria di base (span di job, nodo, attempt; log grezzi; `log_index`)
- motore dei grafi con tutti i tipi di nodo; recipe in JSONC, validate da CLI
- recipe `feature` e `bugfix`; scelta della recipe per job
- source GitHub Issues
- forge GitHub: mirror, push, PR, merge serializzato
- harness: Claude Code e un secondo fornitore per la code review
- runner OCI offline con servizi accanto e proxy di rete
- knowledge base con selezione per ruolo, proposte da CLI
- tier con un solo profilo per ruolo
- limiti di concorrenza globali e per provider
- legame con `head_sha`
- passaggio di mano da CLI

**Fuori:** UI, orchestratore ed editor grafico delle recipe (fase 2), evidence bundle completo (fase 2), Belato con suoni (fase 3), funzione di configurazione del progetto (fase 3), altri harness e adapter generico (fase 4), adattatore AI per le source (fase 4), backup tra profili e promozione (fase 4), più factory insieme e Jira (fase 5), nightly (fase 6).

---

# PARTE III: PIANO

## 35. Roadmap

| Fase | Contenuto | Criteri di uscita |
|---|---|---|
| **0A. Runner e minacce** | Threat model; runner OCI con home pulita; proxy di rete; credenziali GitHub fuori; immagine offline del repo di prova con servizi accanto; prova dei token (in particolare `claude setup-token` in container) e della sostituzione nel proxy per ogni harness; server MCP di peCore con un servizio di prova; test con un repo deliberatamente malevolo. | Il runner non legge home né credenziali GitHub. Il proxy blocca i domini non permessi. Un attempt gira senza download. Rischio residuo documentato. |
| **0B. Repo di prova** | Repo nuovo con i comandi dei controlli, prima knowledge base, 10 issue etichettate `factory`; 3 issue fatte a mano con un agente, misurando tempo, difetti, tentativi. | Baseline misurata. |
| **1. Ciclo minimo** | Perimetro della sezione 34. | Nessuna PR doppia dopo un crash simulato. Nessuna scrittura dei reviewer. Nessun push prima di `human_approve`. `auto_approve_if` che non passa oltre le soglie. Cancel che ferma il runner. Approvazioni invalidate al cambio di `head_sha`. Una prompt injection deliberata bloccata dai permessi effettivi. 10 issue del repo di prova completate. |
| **2. UI ed evidenze** | Chat con l'orchestratore; flusso del job con dettaglio al clic; editor grafico delle recipe; human approve con riassunto e hunk; evidence bundle. | Il giro di un job si segue senza terminale, con evidenze per criterio. |
| **3. Coda umana, Belato, config** | Tutte le azioni umane dalla UI; notifiche; funzione di configurazione del progetto. | Nessuna decisione umana passa dal terminale. |
| **4. Plugin e tier** | Adapter per agy, opencode, pi, Copilot, adapter generico; adattatore AI per le source; discovery per account; tier con backup e promozione; recipe `cleanup`, `dependency-diet`; valutazione dei reviewer. | Un nuovo harness si aggiunge senza toccare il motore. |
| **5. Più factory, Jira** | Più factory insieme, connettore Jira. | Due factory insieme senza sforare quote e limiti. |
| **6. Nightly** | Mutation, fuzz, soak; issue dai fallimenti. | Fallimenti notturni come issue utilizzabili. |

## 36. Rischi

| Rischio | Mitigazione |
|---|---|
| Costruire strumenti invece del prodotto | Flusso completo minimo prima; ogni fase si usa sul repo di prova. |
| Fornitore che cambia condizioni o chiude uno strumento | Plugin, discovery, healthcheck, tier con backup. |
| "Verified slop" | Controlli deterministici prima; code review di fornitore diverso; evidenze per criterio; valutazione dei reviewer. |
| Test compiacenti | Test scritti da un nodo separato dal builder, secondo la spec; `diff_guard` blocca il builder che li modifica; code review sui test. |
| Approver che classifica `safe` un cambio rischioso | Rischio accettato. Modello frontier; template predefinito che lo istruisce a ignorare il testo nel codice; `auto_approve_if` con soglie strette o `human_approve` sempre. |
| Codice generato che danneggia la macchina | Runner isolato, credenziali fuori, proxy. |
| Furto dei token dei modelli | Token vero messo dal proxy, mai nel runner; dove non si può, rischio accettato con runner effimero e rete limitata. |
| Furto delle credenziali dei servizi (Atlassian, GitHub) | Mai nel runner: solo il daemon le usa, tramite il server MCP di peCore con permessi per nodo. |
| Directory di peCore copiata su due computer attivi | Un computer alla volta; lock nel daemon. |
| Connessione lenta | Esecuzione offline; immagini ricostruite solo al cambio del lockfile. |
| Token di Claude non funzionante in container | Prova in fase 0A; alternativa: API key per il runner. |
| Perdita di comprensione del sistema | Knowledge base, spec e decisioni leggibili; `human_approve` con riassunto. |
| Output degli harness che cambiano | Versioni fissate, fixture, log grezzo. |
| Costi fuori controllo | Limiti di concorrenza, budget per job e per giorno, misura per attempt. |
| Dipendenze del progetto che crescono | Recipe `dependency-diet`. |

## 37. Decisioni prese

| Tema | Decisione |
|---|---|
| Nome | peCore, pronunciato PEH-koh-reh; pacchetto e comando `pecore`; significato ufficiale: Pipeline Engine core |
| Linguaggio | TypeScript |
| Sistemi | Linux e macOS |
| Progetto di prova | Repo nuovo, GitHub Issues etichettate `factory` |
| Directory | Unica, `PECORE_HOME`, copiabile, un computer alla volta; nulla nel repo del progetto |
| Salvataggio e condivisione | `PECORE_HOME` è un repo git privato senza dati né segreti; commit automatico dalla UI; import di recipe e ruoli da URL o file |
| Segreti | Cifrati nella directory; password nel portachiavi di ogni computer |
| Autenticazione | Modelli: token segnaposto nel runner, quello vero messo dal proxy; credenziale montata solo dove non si può. Servizi esterni: solo il daemon, esposti al runner come strumenti MCP con permessi per nodo |
| Orchestratore | Chat con l'utente; fa domande, sceglie factory e recipe, avvia più job insieme; senza recipe adatta propone una bozza |
| Recipe | Grafi liberi di nodi e frecce, uno per tipo di task; anche vuoti; frecce all'indietro con `maxRounds` |
| Editor delle recipe | Grafico nella UI, scrive lo stesso JSONC |
| Nomi dei ruoli | orchestratore, spec writer, tests, builder, reviewer, approver |
| Spec writer | Il PM: valuta, scrive la spec e cosa devono verificare i test, divide in subtask paralleli con agenti diversi, sceglie i nodi opzionali; rifiuto immediato con motivo sul ticket |
| Tests | Scrive solo i test |
| Builder | Scrive solo il codice, non tocca i test; riprende la propria sessione |
| Reviewer | Code review generica in tutte le recipe predefinite; specialisti definiti dall'utente, nodi opzionali scelti dallo spec writer |
| Rischio | `safe` o `risky`; lo decide solo l'approver |
| Approver | Classifica ogni hunk `safe` o `risky`; il job è `risky` se almeno un hunk lo è |
| Uscite | Configurabili nella recipe. `pr`: push, PR, `merge` `auto` o `off` |
| Approvazione | Nodi tra approver e uscita, combinabili: `policy_gate` (regole fisse), `auto_approve_if` (soglie), `human_approve` (si ferma, riassunto, hunk per rischio con `safe` nascosti; Approve, Request changes, Reject) |
| Merge diretto | `merge: auto` sull'uscita `pr`, raggiunta senza `human_approve` |
| Approvazioni esterne | PR aperta, il job finisce lì |
| Controlli | Nodi deterministici: diff guard, secret scan con modello locale, format check, lint, typecheck, build, test run configurabile, script libero. Passa o non passa; comandi nella directory di peCore; separati dalla CI; non usano gli script di `package.json` |
| File protetti | ESLint mai; tsconfig estendono una base protetta senza spegnere `strict`; modifiche a mano o con una funzione apposita |
| Knowledge base | Pagine solo Markdown; sorgenti di ogni tipo; creazione con la recipe `handbook`; selezione per ruolo con override nella recipe; proposte importate dall'utente |
| Source | Quattro operazioni; adattatori in codice o AI generico che traduce soltanto; canale delle domande per factory e per job |
| Runner | Interfaccia; container OCI; servizi accanto; offline |
| Rete | Per nodo: `models` (default), `allowlist`, `open`; sempre via proxy |
| Immagine | Ricostruzione automatica al cambio del lockfile, con avviso |
| Concorrenza | Limiti di job e agenti, globali e per provider |
| API | HTTP dalla fase 1, usata dalla CLI |
| Telemetria | Codice proprio, id W3C, separata dal dominio |
| Modelli | 4 tier di agent profile, backup solo per disponibilità, nessuna discesa silenziosa |
| Configurazione | JSONC con JSON Schema generato da Zod |
| UI | Web app servita dal daemon, PWA; Electron solo se serve |
| Eventi | Envelope CloudEvents, ULID, tipi versionati, concorrenza ottimistica per stream, intenzione ed esito per gli effetti esterni |
| Persistenza | SQLite WAL, `events.db` e `telemetry.db` separati |
| Merge | Serializzato dal daemon |
| Notifiche | Belato, con modalità notte; canali esterni come adattatori |
| Manutenzione | Recipe `cleanup` e `dependency-diet` |
| Ordine della fase 1 | Flusso completo minimo prima |

## 38. Domande aperte

1. **Funzione di configurazione del progetto:** forma e posizione.
2. **Canale delle notifiche** fuori dall'app.
3. **Template dei ruoli:** linguaggio dei segnaposto e versionamento.
4. **Budget di contesto** per ruolo: valori iniziali.
5. **Giri dopo Request changes:** contano nel `maxRounds` delle frecce o ripartono da zero?
6. **Controllo di deriva della knowledge base:** segnalare le pagine che citano path o simboli spariti dal codice?
7. **Default di `PECORE_HOME`:** `~/.pecore` o altro.
8. **agy:** quali file di credenziali servono nel runner.
9. **Copilot CLI:** discovery dei modelli più robusta del parser dell'help.
10. **Testcontainers** nei progetti contro servizi accanto al runner.
11. **Retention** della telemetria (proposta: span, metriche e log grezzi 90 giorni; `log_index` 180).
12. **Evoluzione:** aggiornamento del daemon, migrazioni degli schemi, upcasting.
13. **Effort** per opencode e Copilot CLI: valori e flag.
14. **OSC 7501:** adottarlo negli adapter per lo stato "in attesa"?

---

# APPENDICI

## A. Strumenti esistenti

| Strumento | Cosa è | Note |
|---|---|---|
| zazencodes software-factory v2 | Factory con 8 agenti Claude, orchestratore LLM, script di stato | GPLv3. Idee: stato scritto da un solo script, gate dalla copia di main, path protetti, gate ripetuto dopo il sync, un file per agente. Limiti: un fornitore, orchestratore LLM, niente isolamento. |
| Herdr | App desktop e mobile per eseguire agenti nel terminale | Apache 2.0. herdr-core separato dall'app; stato degli agenti via OSC 7501; non riprende il lavoro dopo un riavvio; nessuna pipeline né gate. |
| T3 Code | GUI per gestire agenti di coding | Cabina di pilotaggio, non factory. |
| emdash | UI per più agenti in parallelo | Supporta molte CLI. |
| Claude Squad | TUI con tmux e worktree | Per chi vive nel terminale. |

Differenza chiave: questi strumenti sono **cabine di pilotaggio**, dove l'utente guida; peCore è un **motore**, dove il lavoro procede da solo e l'utente decide nei punti previsti.

## B. Formati scartati

- **YAML:** scartato per preferenza e per la difficoltà di riscriverlo preservando formattazione e commenti.
- **TOML:** buono per configurazioni piatte, pessimo per strutture annidate come le recipe.
- **JSON puro:** niente commenti; sostituito da JSONC.
- **Valibot:** bundle più piccolo, ma il vantaggio non serve nel daemon; Zod resta.
- **Kafka o un log stile Kafka:** inutile alla scala prevista.
- **Handbook, recipe e configurazione in SQLite:** andrebbero riesportati su file per ogni job, perché gli agenti leggono file; si perderebbero editor e git. Restano file.
- **SDK di OpenTelemetry:** non scrive su SQLite e aggiunge dipendenze; sostituito da codice proprio con id compatibili.

## C. Glossario

- **Daemon:** processo sempre acceso in background, senza interfaccia.
- **Nightly build:** build automatica generata ogni notte dall'ultimo commit.
- **Quote:** limiti d'uso delle subscription (finestre di ore, tetti settimanali o mensili).
- **Budget:** limite di spesa con le API key.
- **Head SHA:** il commit in cima al branch di una PR.
- **Hunk:** un blocco contiguo di righe modificate in un diff.
- **Evidence bundle:** prove della decisione su un commit.

## D. Fonti

- Claude Code, headless: https://code.claude.com/docs/en/headless
- Claude Code, token a lunga durata: https://code.claude.com/docs/en/team
- Claude Code, nessun comando per elencare i modelli: https://claudeissues.com/issue/12612-feature-request-add-claude-model-list-cli-command-for-non-interactive-model-quer
- Claude Code, errori 401 con setup-token in container: https://claudeissues.com/issue/40860-setup-token-generates-invalid-bearer-token-401-invalid-bearer-token
- Claude, Agent SDK e `claude -p`: https://support.claude.com/en/articles/15036540
- Divieto di OAuth Claude in harness di terze parti: https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access
- Codex, non interattivo: https://developers.openai.com/codex/noninteractive
- Codex, riferimento CLI: https://learn.chatgpt.com/docs/cli/reference
- Codex, catalogo dei modelli: https://codex.danielvaughan.com/2026/05/04/codex-cli-model-catalogue-architecture-providers-discovery-debug/
- GPT-6.1 Sol in Codex: https://ofox.ai/blog/gpt-61-sol-codex-setup-access/
- Antigravity CLI, headless: https://antigravity.google/docs/cli/headless.md
- Antigravity, regole: https://antigravity.google/docs/rules.md
- Antigravity CLI, guida e chiusura di Gemini CLI: https://www.aibuilderclub.com/blog/antigravity-cli-guide
- opencode, comandi: https://opencode.ai/docs/cli/commands/
- opencode, regole: https://opencode.ai/docs/rules/
- opencode V2, istruzioni: https://v2.opencode.ai/instructions.md
- pi, configurazione: https://pi.dev/docs/latest/configuration
- pi, cheatsheet: https://aiidelist.com/pi-coding-agent-cheatsheet
- Copilot CLI, uso programmatico: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference
- Copilot CLI, comandi: https://docs.github.com/en/copilot/reference/cli-command-reference
- GitHub, merge queue: https://docs.github.com/en/enterprise-cloud@latest/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue
- GitHub, codice non attendibile: https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target
- Herdr: https://herdr.dev/
- CloudEvents: https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md
- OpenTelemetry: https://opentelemetry.io/docs/specs/semconv/
- SQLite WAL: https://www.sqlite.org/wal.html
- zazencodes v2: https://github.com/zazencodes/zazencodes-season-3/tree/main/src/software-factory-claude-code-v2
