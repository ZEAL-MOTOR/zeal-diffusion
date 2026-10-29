# Diffusion Zeal Motor

Ce dépôt est **géré automatiquement** par le tableau de bord « Zeal Motor · Communications internes », installé sur le PC de l'administrateur.

> **Ne le modifiez pas à la main.** Chaque publication remplace tout son contenu : un fichier ajouté ou modifié ici serait effacé.

## À quoi il sert

GitHub Pages le publie à l'adresse https://zeal-motor.github.io/zeal-diffusion. Les widgets Scriptable des employés (« Zeal Général » et « Zeal Personnel ») y téléchargent leurs messages.

| Élément | Contenu |
|---|---|
| `install/` | Page d'installation des widgets (https://zeal-motor.github.io/zeal-diffusion/install/) et les deux scripts, sans aucun secret |
| `activer/` | Page ouverte par le QR code d'activation ; la clé reste dans l'adresse, sur l'iPhone, et n'est jamais envoyée au serveur |
| `feeds/<appareil>.json` | Un fichier par appareil activé, **chiffré** (XSalsa20-Poly1305) avec la clé de cet appareil : seul cet appareil peut le lire |
| `status.json` | Date de la dernière publication |
| `brand/` | Logos Zeal Motor |

## Pourquoi il est public

L'offre gratuite de GitHub Pages exige un dépôt public. Rien de lisible ici n'est confidentiel : les messages, les noms et les clés n'apparaissent dans aucun fichier en clair. On peut seulement voir le nombre d'appareils actifs, les heures de publication, quels fichiers changent et leur taille (arrondie à 2 Ko). L'historique conserve les anciennes versions, toujours chiffrées.

## Administration

Les messages, les employés et les appareils se gèrent dans le tableau de bord, sur le PC (http://localhost:4310). Le code source du système est conservé dans un dépôt privé distinct.

- **Mettre à jour ce dépôt** : il suffit de publier depuis le tableau de bord (automatique, ou « Publier maintenant »).
- **Retirer l'accès d'un appareil** : le révoquer dans le tableau de bord ; son fichier disparaît à la publication suivante.
