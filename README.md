# Quizined

Extension Chrome + serveur proxy pour répondre automatiquement aux questions.

> Respecte les règles de l'établissement/triche discrètement.

## Fonctionnement

1. **L’extension** détecte une question sur la page (ou capture un screenshot).
2. **Le proxy** envoie la requête à l’API OpenAI avec les données nécessaires.
3. **La réponse** est renvoyée à l’extension qui **remplit/coche** automatiquement la bonne réponse.
4. L’extension se **désactive** après chaque auto-remplissage pour éviter les actions involontaires.


## Prérequis

* **Node.js**
* **Clé API OpenAI valide** 
> (Faut mettre de l'argent dans le compte, puis générer une clé.)


## Installation du serveur

```bash
cd server
npm install
```

### Configuration (.env)

Crée un fichier `.env` dans `server/` :

```ini
OPENAI_API_KEY=<clé API>
OPENAI_MODEL=gpt-4o
MAX_OUTPUT_TOKENS=16
```


## Installation de l’extension Chrome

1. Ouvre Chrome et va sur `chrome://extensions`.
2. Active le **Mode développeur** (en haut à droite).
3. Clique sur **Charger l’extension non empaquetée** et sélectionne le dossier **`extension/`** de ce dépôt.
4. Dans les **options de l’extension**, définis l’URL du proxy sur
   **`http://localhost:8787/api/ask`**.


## Utilisation

1. **Démarre le serveur proxy**.
   `npm start` dans le dossier server.
2. Sur une page de quiz, **appuie sur `Left Shift`** pour **activer** l’extension.

   * *L’extension se désactive automatiquement après chaque réponse.*
   * **Réappuie sur `Left Shift` à chaque nouvelle question.**
3. Choisis un mode :

   * ### Mode **texte**

     *Envoie uniquement le texte de la question (plus rapide mais parfois moins fiable).*
    
        Clique sur la question ou sur n’importe quelle réponse → l’extension corrige automatiquement.
   * ### Mode **screenshot**

     *Capture toute la question (c'est mieux que le mode texte).*
    
        Appuie sur la touche **`<`** → l’extension remplit/coche la bonne réponse.
4. **Valide** manuellement pour passer à la question suivante.
5. **Répète** : `Left Shift` → (clic question **ou** touche `<`) → valider.


## Raccourcis

| Raccourci      | Effet                                         |
| -------------- | --------------------------------------------- |
| **Left Shift** | Activer l’extension pour la question en cours |
| **`<`**        | Capturer la question (screenshot) et répondre |


## Problèmes

* **401 / 403 (non autorisé)**
  Clé API invalide ou t'as pas d'argent sur ton compte.


* **L’extension ne réagit pas/ne complète pas la question**

  * Réappuie sur **Left Shift** et réessaie un des deux modes.
  * Si ça fonctionne toujours pas, bah force.




