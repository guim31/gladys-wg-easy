# WireGuard (wg-easy)

Sachez depuis Gladys qui est connecté au VPN WireGuard de la maison, quand ce
VPN est géré par [wg-easy](https://github.com/wg-easy/wg-easy) : un appareil par
client VPN (connecté ou non, données reçues et envoyées, dernier handshake), un
widget pour le tableau de bord, et des déclencheurs de scène quand un client se
connecte ou se déconnecte — par exemple pour savoir que quelqu'un a ouvert le
VPN de la maison pendant votre absence.

Testée contre de vrais serveurs wg-easy 15.4 et 14 sous Docker, avec un vrai
client WireGuard. Vos retours sont les bienvenus sur le
[forum Gladys](https://community.gladysassistant.com) ou dans les
[issues](https://github.com/guim31/gladys-wg-easy/issues).

## Ce qu'il vous faut

- Gladys Assistant 5.1.0 ou plus récent.
- **wg-easy v15** (15.0 à 15.4) ou **v14**, joignable par Gladys sur votre
  réseau local (port 51821 de son interface web par défaut).
- En v15 : l'identifiant et le mot de passe d'un utilisateur wg-easy **sans
  double authentification** (wg-easy refuse alors l'accès à l'API par mot de
  passe). Un admin voit tous les clients, un autre utilisateur seulement les
  siens. L'accès par mot de passe ne doit pas être désactivé
  (`DISABLE_PASSWORD_AUTH`).
- En v14 : le mot de passe de l'interface web, ou rien s'il n'y en a pas.

## Configuration

1. Dans Gladys, installez l'intégration, puis ouvrez son écran
   **Configuration**.
2. **Adresse** : l'adresse de l'interface web de wg-easy, par exemple
   `192.168.1.2:51821`, avec `https://` si elle est servie en HTTPS (derrière
   un reverse proxy, par exemple). Le chemin est ignoré.
3. **Identifiant (v15)** : `admin` par défaut ; ignoré en v14.
4. **Mot de passe** : celui de cet utilisateur (v15) ou de l'interface web
   (v14).
5. **Accepter les certificats auto-signés** : seulement pour une adresse
   `https://` dont le certificat n'est pas signé par une autorité connue.
6. **Intervalle de rafraîchissement** : fréquence de lecture de wg-easy, 30 s
   par défaut. Chaque lecture vérifie le mot de passe côté wg-easy (argon2 en
   v15, une fraction de seconde de processeur).
7. **Autoriser l'activation et la désactivation des clients** : désactivé par
   défaut. Voir plus bas.
8. **Langue des noms** : la langue des noms de fonctionnalités et de la date du
   dernier handshake, fixée à l'ajout d'un appareil.
9. Enregistrez, puis utilisez **Tester la connexion** : elle répond avec la
   version de wg-easy, le nombre de clients et combien sont connectés.
10. Dans l'onglet **Découverte**, ajoutez le serveur et les clients à suivre.

La version (v15 ou v14) est détectée toute seule. Les déclencheurs de scène et
le widget fonctionnent même pour les clients non ajoutés à Gladys.

## Les appareils

**Le serveur** (`wg-easy` suivi de son adresse) :

| Fonctionnalité    | Ce qu'elle montre               |
| ----------------- | ------------------------------- |
| Clients connectés | Clients connectés en ce moment  |
| Clients           | Clients configurés dans wg-easy |

**Chaque client VPN** (son nom dans wg-easy suivi de `(VPN)`) :

| Fonctionnalité       | Ce qu'elle montre                                                                    |
| -------------------- | ------------------------------------------------------------------------------------ |
| Connecté             | Oui quand le dernier handshake date de moins de 3 minutes et que le client est actif |
| Accès autorisé       | Le client est-il activé dans wg-easy (interrupteur, en lecture seule par défaut)     |
| Reçu par le client   | Données téléchargées par le client à travers le VPN, en Mo                           |
| Envoyé par le client | Données envoyées par le client à travers le VPN, en Mo                               |
| Dernier handshake    | Date et heure du dernier handshake WireGuard, ou « Jamais »                          |

**Connecté** suit WireGuard lui-même : tant que des paquets passent, le client
renouvelle son handshake toutes les 2 minutes. Un client qui n'envoie plus rien
(un téléphone en veille, sans _Persistent keepalive_) compte comme déconnecté
3 minutes après son dernier handshake, même si son tunnel reste « activé » sur
le téléphone.

Les compteurs de données sont ceux de l'interface WireGuard : ils repartent de
zéro au redémarrage de wg-easy ou de son interface, et sont inconnus pour un
client désactivé.

**Accès autorisé** est en lecture seule tant que vous ne cochez pas
**Autoriser l'activation et la désactivation des clients**. Une fois cochée,
Gladys, ses scènes et les assistants vocaux peuvent couper l'accès d'un client
(par exemple le profil VPN d'un enfant, le soir). Laissez-la décochée si vous
n'en avez pas besoin : c'est votre accès VPN depuis l'extérieur. Après avoir
changé cette option, utilisez **Mettre à jour** dans l'onglet Découverte pour
que l'interrupteur change dans Gladys.

Un client est identifié par sa clé publique WireGuard : le renommer dans
wg-easy, ou passer de la v14 à la v15, garde l'appareil et son historique.

## Tableau de bord

Le widget **Clients VPN** montre le nombre de clients connectés et de clients,
puis une ligne par client : les connectés d'abord (_Connecté_), puis les autres
avec le temps écoulé depuis leur dernier handshake (_il y a 2 h_ ou _Jamais
connecté_), les désactivés en dernier (_Désactivé_). Dix lignes au plus ;
au-delà, la dernière ligne compte les autres clients.

## Scènes

### Déclencheurs

- **Client VPN connecté** : un client s'est connecté au VPN de la maison (un
  handshake après 3 minutes de silence). Filtre : un client, ou n'importe
  lequel. Variables : nom du client, appareil du client.
- **Client VPN déconnecté** : un client n'a plus fait de handshake depuis
  3 minutes, ou a été désactivé. Filtre : un client, ou n'importe lequel.
  Variables : nom du client, appareil du client, minutes de connexion.
- **wg-easy ne répond plus** : wg-easy ne répond plus (deux lectures de suite).
  Variable : l'erreur.
- **wg-easy répond à nouveau** : wg-easy répond à nouveau après une panne.
  Variable : minutes sans réponse.

Aucun événement n'est envoyé au démarrage de l'intégration : l'état d'avant
n'est pas connu.

### Idées de scènes

- **Quelqu'un a ouvert le VPN de la maison** : _Client VPN connecté_ (n'importe
  quel client) → envoyer un message « {{client}} est connecté au VPN de la
  maison ».
- **Le téléphone de l'enfant est encore sur le VPN la nuit** : _Client VPN
  connecté_, le téléphone de l'enfant, entre 22 h et 7 h → éteindre son _Accès
  autorisé_ (pilotage autorisé).
- **La box du VPN est en panne** : _wg-easy ne répond plus_ → envoyer un
  message avec l'erreur, avant d'avoir besoin du VPN depuis l'extérieur.

## Dépannage

- **« identifiant ou mot de passe refusé (ou double authentification
  active) »** : vérifiez l'identifiant (v15) et le mot de passe. wg-easy v15
  refuse l'accès à l'API par mot de passe à un utilisateur en double
  authentification : créez pour Gladys un utilisateur sans.
- **« accès refusé : connexion par mot de passe désactivée ou utilisateur
  désactivé »** : l'utilisateur est désactivé, ou wg-easy tourne avec
  `DISABLE_PASSWORD_AUTH`.
- **« l'adresse redirige »** : l'adresse répond par une redirection,
  généralement de HTTP vers HTTPS : saisissez l'adresse en `https://`.
- **« certificat refusé »** : cochez **Accepter les certificats auto-signés**.
- **« pas d'API wg-easy à cette adresse »** : l'adresse n'est pas celle de
  l'interface web de wg-easy (vérifiez le port, 51821 par défaut).
- **Un client reste « Connecté : Non » alors que son tunnel est activé** : il
  n'envoie rien. Réglez un _Persistent keepalive_ (25 s) sur ce client dans
  wg-easy pour qu'il soit vu connecté même au repos.
- **Il manque des clients** : un utilisateur wg-easy non admin ne voit que ses
  propres clients : utilisez un admin.

## Limites

- Un seul serveur wg-easy par Gladys.
- wg-easy v15 et v14 seulement ; les versions plus anciennes ne sont pas prises
  en charge.
- « Connecté » se déduit du dernier handshake (3 minutes) : un client qui
  n'envoie rien compte comme déconnecté, une déconnexion se voit jusqu'à
  3 minutes plus une lecture après.
- La date du dernier handshake vient de l'horloge de wg-easy, les 3 minutes se
  comptent avec celle de Gladys : gardez les deux à l'heure (NTP).
- Les compteurs de données repartent de zéro au redémarrage de wg-easy.
- L'intégration ne crée, ne supprime ni ne renomme de client, et n'affiche pas
  leur QR code : cela reste dans wg-easy.
- Sans lien avec wg-easy ni WireGuard. WireGuard est une marque déposée de
  Jason A. Donenfeld.
