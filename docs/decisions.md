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

## Open

- Shipped nodes default to "Automatic" with an optional explicit model (A, recommended), or always need an explicit model (B).
- The node system needs a redesign; proposal: checks (clippy, typecheck, tests) come from the repository instead of being browsed as nodes.
- The Library needs a redesign; proposal: a catalogue of recipes, nodes only inside the recipe editor.
