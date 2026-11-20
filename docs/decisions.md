# PeCore decision history

Antonio's product decisions in the order he made them. Entries are only added, never rewritten: a decision that changes an earlier one is a new entry that names the one it replaces. The current state lives in [design.md](design.md) and [ui-design.md](ui-design.md), which are updated in the same change.

Format: decision. **Why:** Antonio's reason. **Replaces:** what it changes, if anything.

## 2026-11-20, night: Settings and navigation

1. Settings has no text or JSON editing and no user-typed IDs; raw validation errors never reach the screen. **Why:** "Cosa è profile ID? perché un utente dovrebbe inserire Profile ID?" **Replaces:** the Profiles and tiers editor and the accounts JSON editor (ui-design.md IG2, Settings).
2. Settings sections are organised on the page and adapt to the window width. **Why:** "è tutto dispersivo e richiede compilazione testuale."
3. "Edit accounts as JSON" is removed. **Why:** "VIA".
4. Every installed harness appears under Accounts by itself. **Why:** "Sotto Accounts devono comparire in automatico tutti i providers disponibili."
5. Models are not configured in Settings: they are chosen where they are used, on each agent node (provider, model, effort) and for the orchestrator. Effort is per node. **Why:** "Non si possono configurare i modelli nei settings, non ha senso. Deve essere fatto a livello di nodo." **Replaces:** Profiles and tiers in Settings (IG2).
6. The Models section of Settings is removed. **Why:** consequence of 5.
7. Settings > Orchestrator lets the user pick Provider, Model and Effort. **Why:** "deve permettere di scegliere Provider, Modello ed Effort". **Replaces:** the orchestrator profile select (IG6).
8. Account rows are clean: no "your existing login" text; the Check button must look clickable; Log in appears only when needed. **Why:** "Recheck Login non si capisce che si clicca."
9. Git hosting texts never name a hosting service. **Why:** "non nominare qui i provider di repo".
10. Hosting services to support later: Bitbucket, Codeberg, Gitea, Forgejo, SourceHut, AWS CodeCommit.
11. A private Git server is supported now: existing repositories over HTTPS or SSH with the user's own Git credentials, the job branch pushed as the delivery, merge detected when the job commit reaches the target branch, no repository creation, no tickets. **Why:** "il privato adesso, subito."
12. OpenCode is ready when it lists at least one model; it never shows "unknown". **Why:** "perché opencode dice unknown?"
13. A page's own sub-navigation (Settings sections, conversations) goes in the main sidebar under the main items, not in a second column. **Why:** "È spazio sprecato." **Replaces:** the second column of Settings and Orchestrator.
14. The sidebar has no group titles ("Build" removed); Settings sits with the other items, after Usage. **Replaces:** Workspace, Build and System groups (ui-design.md Navigation).
15. Page content is centred. **Why:** "credo che il contenuto vada centrato".
16. Every Settings section, Accounts included, has a one-line description. **Why:** "manca la linea descrittiva, sembra un difetto rispetto alle altre sezioni."
17. `pnpm dev` runs the app with live reload, with no build first. **Why:** "una modalità dev dove vedo le modifiche in realtime senza compilare".
18. No GUI tests until the redesign is finished; typecheck, lint and engine tests still run on every change. **Why:** "che senso ha fare test di ui se la cambiamo ogni 30 secondi?"
19. A select and a combobox look the same: same arrow, no clear button; a focused field shows one focus ring; while options load the field shows a spinner and never looks disabled. **Why:** "Perché la freccia è diversa? Perché c'è una croce?", "sembra bloccato o disabilitato".

## 2026-11-20: Orchestrator chat and notifications

20. The orchestrator reply appears while it is written. **Why:** not recorded; asked of GPT during the night.
21. A resumed conversation uses the model selected in Settings. **Why:** not recorded; a resumed chat ran on Sol with Luna selected.
22. After sending, the cursor stays in the message box; opening a conversation puts it there. **Why:** "quando mando un messaggio, la chat perde il focus."
23. Animated dots show the orchestrator is working until its reply starts. **Why:** "l'app sembra bloccata".
24. A conversation can be compacted, as in the harnesses: a Compact button in the header, or `/compact` typed as a message; the chat shows a divider. **Why:** "La chat dovrebbe permettere la compattazione, come avviene con gli harness."
25. A system notification appears only when the PeCore window is not focused (option A). **Why:** a notification for every reply while chatting.
26. Orchestrator in the sidebar reopens the last conversation of this run of the app; clicking it inside the Orchestrator opens a new conversation. **Why:** "devo ogni volta riselezionarla".
27. Chat replies never go to the notification list; the unread counts show them. **Why:** "ho una lista delle risposte della chat... è ridicolo." **Replaces:** "orchestrator replied" in IA3.
28. What the orchestrator does appears under its reply, never under the user's message. Actions that change something get a card (create jobs, answer a job's question, add a node or recipe to a project, comment on a ticket); reads become one grey line (option A). **Why:** "non dovrebbero apparire sotto la mia nuvola, perché non sono mie operazioni."
29. Every product decision is recorded here, and design.md and ui-design.md are kept in sync with it. **Why:** "Serve un documento che ricorda tutte queste decisioni."
30. The project filter in the top bar is removed. **Why:** it shows on every page and works on three; "L'app sembra una accozzaglia di slop". **Replaces:** IA5, UI13, the top bar filter.
31. The New job button and its form are removed; jobs start from the orchestrator chat. **Why:** same as 30; it duplicated the chat with internal concepts (recipe, base branch, parent job). **Replaces:** IC10, New job modal.

32. Layout: menu on the left, orchestrator chat always on screen on the right. The Orchestrator page goes away. **Why:** "la pagina orchestrator è inutile effettivamente. Voglio la chat dell'orchestratore sempre on screen." **Replaces:** the Orchestrator page and the mini chat closed by default (ui-design.md UI2b).
33. The app must work in a 1024×720 window. **Why:** "Altrimenti nel MacBook NEO non entra." **Replaces:** no minimum size was set (the window could shrink to 960×600 with no layout rules).

34. The left menu can be hidden and shown with a button, as in modern apps. **Why:** "Il menu a sinistra deve essere a scomparsa come in tutte le app moderne."

35. The app is minimal: nothing on screen that the user does not need to act or decide. The engine status line at the bottom of the menu is removed. **Why:** "era solo cringe. Non ho capito a cosa serve per l'utente. QUESTA APP SARÀ MINIMALE ANTISLOP". **Replaces:** IA4 engine status in the menu (the disconnected banner stays).

36. One chat for the whole app: no multiple conversations, no conversation list. **Why:** "Una unica chat per TUTTO, con possibilità di compattare." **Replaces:** conversations (IB1), the conversation select and New conversation button of decision 32.
37. The chat compacts by itself, with two thresholds in tokens set in Settings: above the maximum (default 256,000) it compacts at once; above the automatic one (default 128,000) it compacts after 5 minutes without use. The Compact button stays. **Why:** "due soglie, una massima ed una auto"; "numero di tokens"; "Per le soglie metti 128K e 256K. Proviamo così prima."
38. Two roles. The Assistant is the one the user talks to, in the single chat; it acts on the app for the user and has access to everything in the projects. The Orchestrator works in the background on what does not come from the user (new issues of linked projects): it creates jobs and reports in the Assistant's chat with a short message; the user never chats with it. **Why:** "l'orchestratore è l'assistente dell'app. Come jarvis"; "un agente nascosto che si occupa di gestire le richieste che non sono dell'utente"; "l'orchestratore principale deve avere accesso a tutto nel progetto"; "Conviene forse definire bene i due ruoli?" **Replaces:** the single orchestrator of design.md section 6 and the per-project intake conversations.
39. Anything that leaves the app outside a recipe needs the user's approval. A job following its recipe needs none (a recipe that opens a PR opens it). A question or comment on GitHub, Jira or any other service that no recipe prescribes becomes a request the user approves or rejects. An order the user gives in the chat is already authorised. **Why:** "Fare cose oltre il job, richiede autorizzazione. Se nella recipe dice di fare PR, è ok. Ma fare una domanda su github o jira, non è prestabilito. Devo approvare io, per il momento. Ovviamente se mando io l'ordine è autorizzato... la mia paura è che l'AI prenda decisioni errate, devo controllare." **Replaces:** the Orchestrator's free `comment_ticket` on unclear tickets (design.md sections 6 and 7).

40. Everything inside a recipe the user approved runs with no further approval, its scripts included. A new or changed recipe needs the user's approval. Outside recipes, the Assistant can do anything Claude Code could do on the user's computer. **Why:** "tutto quello che è in una recipe già approvata da me può girare senza problemi. Per il resto l'assistente può tutto quello che sarebbe possibile fare tramite claude code." **Replaces:** the separate confirmation of each `runsAs: engine` and `source` node (design.md section 8), and the open question on whether the Assistant may approve scripts.

41. With the menu hidden, pointing at the menu button shows the menu over the page, and moving away hides it; clicking the button keeps it open in its column. **Why:** "quando si fa hover sopra l'icona, la barra deve comparire sopra il contenuto della pagina. Come in claude web. Se si clicca sull'icona, la barra diventa fissa."

42. During development, stored data is not kept across changes: the code stays clean, with no migration or fallback for old data. The old conversations are deleted; `chats.db` is rebuilt with the Assistant chat only. **Why:** "le conversazioni vecchie eliminale. Agisci senza considerare i dati, puoi cambiare eventi tabelle TUTTO. Mi interessa codice pulito."
43. The Orchestrator has its own compaction thresholds in Settings, like the Assistant (default 128,000 and 256,000). **Why:** "Aggiungi le impostazioni per l'agente dell'orchestrator anche." **Replaces:** one pair of thresholds for every chat (decision 37).
44. What the Orchestrator does arrives as a notification, not as a message in the Assistant's chat. **Why:** "per le notifiche dell'orchestrator, è meglio mandare una notifica appunto invece di scrivere nella chat dell'assistente." **Replaces:** the Orchestrator's reports in the chat (decision 38).
45. Notifications and the Inbox are one page, Notifications, in the menu: first what waits for a decision, then the notification log. The bell in the top bar is removed. **Why:** "Fai scrivere in Inbox. Rinomina Inbox, chiamalo Messages o altro di più intuitivo"; Notifications chosen over Messages, which is confused with the chat. **Replaces:** the Inbox page and the notification popover (IA3).
46. Saving a recipe or node in an editor counts as the user's approval (decision 40); only changes written by an agent wait for approval. **Why:** chosen option "Save vale come approvazione".
47. Fetching tickets will become a recipe run on a schedule, so the ticket source needs no separate confirmation. Planned for later. **Why:** "Gestiamo il reperimento di tickets con un sistema di scheduling. Dunque creeremo una recipe e la mettiamo in scheduling. Dopo."
48. In a Provider, Model and Effort picker, Effort is locked until a model is chosen. **Why:** "se non si seleziona prima un modello, non si deve poter scegliere l'effort".
49. Settings save by themselves as soon as a value changes; there is no save bar, Save or Discard button. A value that is not valid is not saved and the problem is shown. A provider with no model yet is not saved. **Why:** "Il salvataggio deve essere continuo, non deve esserci questo pannello con 'save settings'". **Replaces:** the Save settings bar.
50. The models of each AI tool are read once when the app starts, not every time Settings opens. A small refresh button next to Model reads them again. **Why:** "La ricerca dei modelli deve avvenire solo all'avvio, non ogni volta che torno in settings. Aggiungi un piccolo pulsante invece per rifare il check forzato, refresh."
51. Every working account shows "Logged in", OpenCode and a private Git server included. **Why:** "metti 'logged in' per tutti". **Replaces:** "Ready" for OpenCode (decision 12) and for a private Git server.
52. Effort lists only what the chosen model offers; a model with no effort levels offers only Default. Choosing another model resets Effort to Default. **Why:** "questo modello, ha solo default" (Effort showed the levels of the tool's default model). **Replaces:** one effort list per AI tool.
53. No quiet hours in PeCore: the operating system handles do-not-disturb. The Notifications section of Settings and the `quietHours` setting are removed. **Why:** "Questo è qualcosa che si gestisce a livello OS. È slop." **Replaces:** IG8 notifications and quiet hours.
54. The GUI uses the size scale of Claude web for readability: body text 14 px, controls 36 px, menu rows 34 px with 20 px icons, buttons with only an icon 32 px with a 20 px icon, icon lines 1.5 px at every size. Every size is a variable in `tokens.css`; components never write a number for text, control, row or icon size, so a change of scale touches one file. **Why:** "preferisco le dimensioni di claude"; "voglio una GUI ad alta leggibilità, semplice, chiara ma potente"; "il tratto delle icone è troppo spesso per le loro dimensioni"; "Il design system deve sfruttare le variabili css globali, così non devi cambiare i valori in 300 posti diversi". **Replaces:** the 13 px scale with 32 px controls and sizes written in each component.
55. The hidden menu shrinks to a column of icons instead of disappearing; each icon shows its name on pointing. **Why:** asked of GPT; reason not recorded. **Replaces:** the hidden menu shown over the page on pointing (decisions 34, 41).
56. The Assistant chat panel can be widened or narrowed by dragging its left edge, or with the arrow keys on that edge. **Why:** asked of GPT; reason not recorded.
57. The chat header has two icon buttons: Compact, and Clear, which after a confirmation deletes the conversation and starts a new Assistant session. **Why:** asked of GPT; at 16 px the two icons could not be read ("non si capivano a 16x16"). **Replaces:** the Compact text button as the only header control (decisions 24, 36).
58. Each notification in the log can be deleted with a trash button on its row. **Why:** asked of GPT; reason not recorded.
59. The user's chat messages sit in a bubble that keeps the accent colour at the bottom-right corner and fades towards the top-left corner to a lighter shade in a light theme, a darker shade in a dark theme, with the text colour used on the accent. Theme colours meet the WCAG contrast of 4.5:1 for text. **Why:** "fai queste nuvolette sfumate, più delicate"; "usa come uno dei gradienti il colore di prima, e l'altro più chiaro"; "Quando è dark la sfumatura deve essere più scura, non più chiara, altrimenti non si legge bene il testo"; "il tema everforest light non si legge. Usa test di leggibilità". **Replaces:** the solid accent bubble.
60. Appearance has a mode (System, Light, Dark) and two theme choices, one for light and one for dark; System follows the operating system and switches between them. Shipped themes: Default Light, Default Dark, Everforest Light, Everforest Dark; a theme file from `PECORE_HOME/themes/` shows under light or dark by its background. **Why:** "Deve essere possibile scegliere il tema Light ed il Tema Dark. I temi di base chiamali Default Light e Default Dark, poi aggiungi anche un Everforest Light ed un Everforest Dark." **Replaces:** one choice among System, Light, Dark and a custom theme file (UI4, IG9).

## Open

- Shipped nodes default to "Automatic" with an optional explicit model (A, recommended), or always need an explicit model (B).
- The node system needs a redesign; proposal: checks (clippy, typecheck, tests) come from the repository instead of being browsed as nodes.
- The Library needs a redesign; proposal: a catalogue of recipes, nodes only inside the recipe editor.
