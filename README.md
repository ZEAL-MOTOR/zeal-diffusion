# Diffusion Zeal Motor

Ce dépôt est **géré automatiquement** par le tableau de bord « Zeal Motor · Communications internes », installé sur le PC (ou le serveur) de l'administrateur.

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
| `projets/` | Visionneuse de l'avancement des projets (si des projets sont publiés) ; `projets/data/` est **chiffré** avec la clé des projets, qui n'est que dans le lien de consultation |

La visionneuse s'ouvre sur le niveau 1 du plan (tâches regroupées) ; son menu *Niveaux* permet d'en ouvrir plus.

## Pourquoi il est public

L'offre gratuite de GitHub Pages exige un dépôt public. Rien de lisible ici n'est confidentiel : les messages, les noms, les plannings et les clés n'apparaissent dans aucun fichier en clair. On peut seulement voir le nombre d'appareils actifs et de projets publiés, les heures de publication, quels fichiers changent et leur taille (arrondie à 2 Ko pour les fichiers des appareils, exacte pour ceux des projets). L'historique conserve les anciennes versions, toujours chiffrées.

## Administration

Les messages, les employés, les appareils et les projets se gèrent dans le tableau de bord, sur le PC (http://localhost:4310). Le code source du système est conservé dans un dépôt privé distinct, d'où le tableau de bord installe aussi ses mises à jour (*Paramètres › Mise à jour de l'application*).

- **Mettre à jour ce dépôt** : il suffit de publier depuis le tableau de bord (automatique, ou « Publier maintenant »).
- **Retirer l'accès d'un appareil** : le révoquer dans le tableau de bord ; son fichier disparaît à la publication suivante.
- **Passer sur un serveur de l'entreprise** (*Paramètres › Diffusion*) : ce dépôt n'est alors plus mis à jour. Une fois les scripts recopiés sur les iPhone depuis la nouvelle page d'installation, supprimez-le : son contenu reste public, même chiffré, tant qu'il existe.
