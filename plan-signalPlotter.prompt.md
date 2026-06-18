## Plan: Signal Plotter Study App

Realizzare una web app educativa per Segnali e Sistemi, partendo da zero come nuova SPA moderna. L'obiettivo e` offrire input guidato per segnali continui e discreti, composizione di piu` segnali, analisi nel tempo e nella frequenza, e un set di strumenti da studio con impostazioni persistenti nel browser. La notazione del docente deve essere configurabile e deve influenzare anche l'input accettato, non solo le etichette mostrate.

**Steps**
1. Definire l'architettura base della nuova app: frontend SPA con routing per le aree Tempo, Discreto, Fourier/Frequenza e Impostazioni, piu` un modello dati comune per segnali, operazioni, grafici e preferenze utente. *Dipende solo dalla scelta dello stack e non richiede altre parti del progetto.*
2. Progettare il motore dei segnali come layer puro di dominio: parser dell'espressione, AST dei segnali, supporto a operazioni algebriche e di sistema, campionamento, periodicizzazione, convoluzione, derivazione, filtri, interpolazione, quantizzazione, composizione e gestione di aliasing. Questo layer deve poter essere testato senza UI.
3. Progettare il sistema di analisi: calcolo di energia/potenza, frequenza/periodo, zeri, ampiezza, simmetrie, supporto a segnali periodici e non periodici, Fourier series, DTFT, DFT, e avvisi educativi per fenomeni come aliasing nel tempo e nella frequenza.
4. Implementare il renderer grafico multi-signal: piu` grafici contemporanei, assegnazione automatica di un colore per ciascun segnale, evidenziazione dei punti notevoli, e sincronizzazione delle viste nel tempo e nella frequenza. *Parallelizzabile in parte con gli step 2 e 3, ma dipende dal modello dati comune.*
5. Costruire la UI di inserimento segnali con sintassi guidata ma flessibile: campi per definire segnali base e composti, selezione della notazione del corso, validazione degli input, e preview immediata del segnale risultante. La notazione configurabile deve aggiornare sia il parser sia le formule mostrate.
6. Aggiungere il pannello informativo per ogni segnale: una box separata per ciascun grafico con toggle visibile/nascosta, e contenuti come tipo di segnale, energia o potenza, frequenza, periodo, dominio di validita`, indicatori utili per lo studio e warning educativi.
7. Implementare la pagina Discreto dedicata: visualizzazione nel tempo discreto, DTFT e DFT, con gestione esplicita di campionamento, periodicita`, aliasing e lettura dei risultati in forma educativa.
8. Implementare la pagina Fourier/Frequenza: serie di Fourier e strumenti collegati a filtri e risposta in frequenza, mantenendo coerenza visiva e funzionale con la vista temporale.
9. Aggiungere la sezione Impostazioni persistenti: salvataggio in localStorage o equivalente browser, gestione della notazione del docente, preferenze grafiche, visibilita` dei box info, modalita` di visualizzazione e altre opzioni educative.
10. Rifinire l'esperienza d'uso con feedback chiari su errore di parsing, input non valido, assenza di periodicita`, campionamento insufficiente, aliasing e limiti di definizione, piu` una schermata di aiuto con esempi per lo studio.
11. Chiudere con una fase di test e validazione end-to-end: test di dominio per parser e analisi, test di componenti per grafici e pannelli info, e una verifica manuale dei casi studio piu` importanti per Segnali e Sistemi.

**Relevant files**
- `package.json` - dipendenze, script, stack e configurazione build.
- `src/main.*` - bootstrap dell'app.
- `src/app/*` - routing e layout generale.
- `src/domain/signals/*` - AST, parser, operatori e calcoli sui segnali.
- `src/domain/analysis/*` - energia, potenza, periodicita`, Fourier, DTFT, DFT, aliasing e metriche.
- `src/components/plot/*` - grafici multi-segnale, colori, marker dei punti notevoli.
- `src/components/info-panel/*` - box informative per ciascun segnale.
- `src/pages/time/*` - editor e vista del dominio del tempo.
- `src/pages/discrete/*` - segnali discreti, DTFT e DFT.
- `src/pages/fourier/*` - serie di Fourier e viste in frequenza.
- `src/pages/settings/*` - preferenze utente persistenti.
- `src/state/*` - stato condiviso, selezione segnali, preferenze e sincronizzazione UI.
- `src/lib/persistence/*` - serializzazione e storage nel browser.
- `tests/*` - test unitari e di integrazione per parser, analisi e UI critica.

**Verification**
1. Validare il parser con casi positivi e negativi per segnali continui, discreti, somme, prodotti, convoluzioni e notazioni alternative del corso.
2. Verificare i calcoli di energia/potenza, periodo, frequenza e Fourier su segnali campione noti del corso.
3. Controllare che la selezione delle impostazioni resti salvata dopo refresh e riapertura della pagina.
4. Eseguire test UI su multi-grafico, toggle delle info box, cambio colore automatico e rendering di zeri e ampiezza.
5. Verificare manualmente i flussi principali: inserimento segnale, composizione di piu` segnali, vista discreta, DTFT, DFT, Fourier series, campionamento, aliasing e filtri.

**Decisions**
- Il progetto parte come nuova SPA moderna, non come integrazione in un'app esistente.
- La sintassi di input deve restare guidata e controllata, non un linguaggio completamente libero.
- La notazione del docente deve essere configurabile anche nel parser, oltre che nella UI.
- Il primo rilascio deve coprire sia dominio del tempo sia dominio discreto e della frequenza, perche` sono centrali nello studio della materia.
- Il sistema deve privilegiare chiarezza didattica e spiegazioni operative, non solo correttezza numerica.

**Further Considerations**
1. Serve decidere se il parsing verra` fatto con un linguaggio simbolico gia` esistente o con un parser custom leggero; consiglio un parser dedicato con funzioni predefinite per tenere sotto controllo la sintassi.
2. Va chiarito se la visualizzazione delle formule deve usare rendering matematico avanzato o una UI testuale pulita; consiglio rendering matematico dove utile, ma senza bloccare il resto del prodotto.
3. Potrebbe essere utile prevedere un set di esempi didattici pre-caricati, cosi` lo studente può partire da segnali tipici del corso.
