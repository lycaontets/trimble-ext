# Extension Trimble Connect – Échange de données IFC (JPF-Ducret)

Extension de la visionneuse 3D (HTML/JS pur, sans build) basée sur la
Trimble Connect Workspace API (`trimble-connect-workspace-api` v0.3.38, script
`https://components.connect.trimble.com/trimble-connect-workspace-api/index.js`).

## Fonctions
- **Connexion** : `TrimbleConnectWorkspace.connect(window.parent, onEvent, 30000)` ; affiche le projet (`project.getProject()`) et les modèles chargés (`viewer.getModels("loaded")`), rafraîchis sur `viewer.onModelStateChanged`.
- **Exporter la sélection** : `viewer.getSelection()` → `viewer.getObjectProperties()` + `viewer.convertToObjectIds()` (GUID IFC) par lots de 500 → CSV (`;`, UTF-8 BOM, compatible Excel FR) + JSON.
- **Exporter tout le modèle** : `viewer.getObjects()` puis même traitement par lots.
- **Importer CSV/JSON** : colonne `GUID`/`GlobalId`/`IfcGUID` obligatoire ; colonne optionnelle `Couleur`/`Color` (#RRGGBB) ou `Valeur`/`Decision`/`Statut` (une couleur par valeur, légende affichée). Correspondance via `viewer.convertToObjectRuntimeIds()`, puis :
  colorer (`viewer.setObjectState(sel, {color})`), sélectionner (`viewer.setSelection(sel, "set")`) ou isoler (`setObjectState` visible false/true).
  Compatible avec `_decisions.csv` du convertisseur (si l'en-tête contient `GUID`).
- **Réinitialiser** : `setObjectState(undefined, {color:"reset", visible:"reset"})`.
- **Colorer par** : « Analyser les attributs » parcourt tous les objets (`viewer.getObjects()` + `viewer.getObjectProperties()` par lots de 500, progression affichée) et remplit la liste : Nom, Matériau, Classe IFC et chaque `Pset.Propriété`. « Appliquer » colore chaque valeur distincte (`viewer.setObjectState` par groupe) ; couleurs fixes Bois #A0522D, Béton #9E9E9E, Acier #4682B4, palette pour le reste. Légende : nombre d'objets, sélecteur de couleur (changement en direct) et case à cocher afficher/masquer (`setObjectState {visible}`). « Tout afficher » rend tout visible.
- **Colorer la sélection** : couleur choisie appliquée à `viewer.getSelection()`.
- **Journal** : toutes les erreurs API s'affichent en rouge.

## Hébergement (GitHub Pages)
1. Créer un dépôt public, y copier `index.html`, `app.js`, `lib.js`, `icon.svg`, `manifest.json`.
2. Settings > Pages > branche `main`, dossier `/`.
3. Dans `manifest.json`, remplacer `VOTRE-COMPTE` par l'URL réelle. HTTPS obligatoire.
(Tout hébergeur statique HTTPS convient : Netlify, Azure Static Web Apps…)

## Ajout dans Trimble Connect
Projet > **Paramètres > Extensions** > **Ajouter une extension** > coller l'URL du
`manifest.json` (ex. `https://votre-compte.github.io/trimble-ext/manifest.json`).
Il faut être administrateur du projet. Activer l'extension, puis ouvrir la vue 3D :
elle apparaît dans le panneau latéral des extensions.

## Limites connues
- L'API Workspace **ne peut pas écrire de propriétés dans l'IFC** ni modifier le fichier : seulement lecture, sélection, couleur, visibilité, caméra, etc. Pour « renvoyer » des données : couleurs/sélection temporaires, ou réimporter un IFC modifié par le convertisseur.
- **Téléverser des fichiers** (CSV, IFC) dans le projet nécessite l'API REST Trimble Connect + OAuth (Trimble Identity, application enregistrée) ; non inclus. `extension.requestPermission("accesstoken")` existe dans l'API mais n'a pas été testé ici.
- Les couleurs/isolations ne sont pas persistantes (perdues au rechargement) sauf à créer une vue.
- Le GUID n'est disponible que pour les modèles IFC (autres formats : identifiant différent).
- Le « matériau » exporté est la première propriété dont le nom contient « matériau/material » ; les noms exacts des Psets dépendent du fichier.

## Remarque
L'analyse charge les propriétés de tous les objets : sur un gros modèle (dizaines de milliers d'objets) elle peut prendre du temps ; après un changement de modèles, elle est refaite au prochain « Appliquer ».

## Test local (sans Trimble)
`npm install && node test/mock-test.js` (API simulée avec jsdom).
