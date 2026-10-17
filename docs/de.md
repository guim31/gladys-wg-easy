# WireGuard (wg-easy)

Sieh in Gladys, wer mit dem WireGuard-VPN deines Zuhauses verbunden ist, wenn
dein VPN von [wg-easy](https://github.com/wg-easy/wg-easy) verwaltet wird: ein
Gerät pro VPN-Client (verbunden oder nicht, empfangene und gesendete Daten,
letzter Handshake), ein Dashboard-Widget und Szenen-Auslöser, wenn sich ein
Client verbindet oder trennt — zum Beispiel, um zu erfahren, dass jemand das
VPN des Hauses geöffnet hat, während du unterwegs bist.

Getestet mit echten wg-easy-Servern 15.4 und 14 in Docker und einem echten
WireGuard-Client. Rückmeldungen sind willkommen im
[Gladys-Forum](https://community.gladysassistant.com) oder in den
[Issues](https://github.com/guim31/gladys-wg-easy/issues).

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- **wg-easy v15** (15.0 bis 15.4) oder **v14**, von Gladys aus über dein
  lokales Netzwerk erreichbar (standardmäßig Port 51821 der Weboberfläche).
- Für v15: Benutzername und Passwort eines wg-easy-Benutzers **ohne
  Zwei-Faktor-Authentifizierung** (wg-easy verweigert einem solchen Benutzer
  den Zugriff auf die API per Passwort). Ein Admin sieht alle Clients, ein
  anderer Benutzer nur seine eigenen. Der Zugriff per Passwort darf nicht
  deaktiviert sein (`DISABLE_PASSWORD_AUTH`).
- Für v14: das Passwort der Weboberfläche, oder nichts, wenn es keins gibt.

## Einrichtung

1. Installiere die Integration in Gladys und öffne ihren Bildschirm
   **Konfiguration**.
2. **Adresse**: die Adresse der Weboberfläche von wg-easy, zum Beispiel
   `192.168.1.2:51821`, mit `https://`, wenn sie über HTTPS ausgeliefert wird
   (etwa hinter einem Reverse Proxy). Der Pfad wird ignoriert.
3. **Benutzername (v15)**: standardmäßig `admin`; in v14 ignoriert.
4. **Passwort**: das Passwort dieses Benutzers (v15) oder der Weboberfläche
   (v14).
5. **Selbstsignierte Zertifikate akzeptieren**: nur für eine
   `https://`-Adresse, deren Zertifikat nicht von einer bekannten Stelle
   signiert ist.
6. **Aktualisierungsintervall**: wie oft wg-easy abgefragt wird, standardmäßig
   30 s. Jede Abfrage prüft das Passwort auf der Seite von wg-easy (argon2 in
   v15, ein Bruchteil einer Sekunde Rechenzeit).
7. **Aktivieren und Deaktivieren der Clients erlauben**: standardmäßig aus.
   Siehe unten.
8. **Sprache der Namen**: die Sprache der Funktionsnamen und des Datums des
   letzten Handshakes, beim Hinzufügen eines Geräts festgelegt.
9. Speichere und nutze dann **Verbindung testen**: Die Antwort nennt die
   Version von wg-easy, die Zahl der Clients und wie viele verbunden sind.
10. Füge im Tab **Erkennung** den Server und die Clients hinzu, die du
    verfolgen willst.

Die Version (v15 oder v14) wird automatisch erkannt. Die Szenen-Auslöser und
das Widget funktionieren auch für Clients, die du nicht zu Gladys hinzugefügt
hast.

## Die Geräte

**Der Server** (`wg-easy` gefolgt von seiner Adresse):

| Funktion           | Was sie zeigt                    |
| ------------------ | -------------------------------- |
| Verbundene Clients | Gerade verbundene Clients        |
| Clients            | In wg-easy eingerichtete Clients |

**Jeder VPN-Client** (sein Name in wg-easy gefolgt von `(VPN)`):

| Funktion             | Was sie zeigt                                                                         |
| -------------------- | ------------------------------------------------------------------------------------- |
| Verbunden            | Ja, wenn der letzte Handshake jünger als 3 Minuten und der Client aktiviert ist       |
| Zugang aktiviert     | Ob der Client in wg-easy aktiviert ist (ein Schalter, standardmäßig schreibgeschützt) |
| Vom Client empfangen | Daten, die der Client über das VPN heruntergeladen hat, in MB                         |
| Vom Client gesendet  | Daten, die der Client über das VPN hochgeladen hat, in MB                             |
| Letzter Handshake    | Datum und Uhrzeit des letzten gesehenen WireGuard-Handshakes (vorher leer)            |

**Verbunden** folgt WireGuard selbst: Solange Pakete fließen, erneuert der
Client seinen Handshake alle 2 Minuten. Ein Client, der nichts mehr sendet
(ein Telefon im Ruhezustand, ohne _Persistent keepalive_), gilt 3 Minuten nach
seinem letzten Handshake als getrennt, auch wenn sein Tunnel auf dem Telefon
noch „an“ ist.

Die Datenzähler sind die der WireGuard-Schnittstelle: Diese beginnen bei null,
wenn wg-easy oder seine Schnittstelle neu startet, und sind für einen
deaktivierten Client unbekannt.

wg-easy vergisst den letzten Handshake eines deaktivierten oder wieder
aktivierten Clients: Die Integration zeigt weiter den letzten, den sie gesehen
hat.

**Zugang aktiviert** ist schreibgeschützt, solange du **Aktivieren und
Deaktivieren der Clients erlauben** nicht ankreuzt. Danach können Gladys, ihre
Szenen und Sprachassistenten den Zugang eines Clients sperren (zum Beispiel
das VPN-Profil eines Kindes am Abend). Lass die Option aus, wenn du sie nicht
brauchst: Es ist dein VPN-Zugang von außen. Nutze nach dem Ändern dieser
Option **Aktualisieren** im Tab Erkennung, damit sich der Schalter in Gladys
ändert.

Ein Client wird an seinem öffentlichen WireGuard-Schlüssel erkannt: Ihn in
wg-easy umzubenennen oder von v14 auf v15 zu wechseln, behält das Gerät und
seinen Verlauf.

## Dashboard

Das Widget **VPN-Clients** zeigt die Zahl der verbundenen Clients und der
Clients, dann eine Zeile pro Client: zuerst die verbundenen (_Verbunden_),
dann die anderen mit der Zeit seit ihrem letzten Handshake (_vor 2 Std._ oder
_Kein Handshake bekannt_), zuletzt die deaktivierten (_Deaktiviert_). Höchstens zehn
Zeilen; darüber hinaus zählt die letzte Zeile die weiteren Clients.

## Szenen

### Auslöser

- **VPN-Client verbunden**: Ein Client hat sich mit dem VPN des Zuhauses
  verbunden (ein Handshake nach 3 Minuten Stille). Filter: ein Client oder
  beliebig. Variablen: Name des Clients, Gerät des Clients.
- **VPN-Client getrennt**: Ein Client hatte seit 3 Minuten keinen Handshake
  mehr oder wurde deaktiviert. Filter: ein Client oder beliebig. Variablen:
  Name des Clients, Gerät des Clients, Minuten verbunden.
- **wg-easy antwortet nicht mehr**: wg-easy antwortet nicht mehr (zwei
  Abfragen in Folge). Variable: der Fehler.
- **wg-easy antwortet wieder**: wg-easy antwortet nach einem Ausfall wieder.
  Variable: Minuten ohne Antwort.

Beim Start der Integration wird kein Ereignis gesendet: Der vorherige Zustand
ist nicht bekannt.

### Szenen-Ideen

- **Jemand hat das VPN des Hauses geöffnet**: _VPN-Client verbunden_
  (beliebiger Client) → eine Nachricht senden „{{client}} ist mit dem VPN des
  Hauses verbunden“.
- **Das Telefon des Kindes ist nachts noch im VPN**: _VPN-Client verbunden_,
  das Telefon des Kindes, zwischen 22 und 7 Uhr → seinen _Zugang aktiviert_
  ausschalten (Steuerung erlaubt).
- **Die VPN-Box ist ausgefallen**: _wg-easy antwortet nicht mehr_ → eine
  Nachricht mit dem Fehler senden, bevor du das VPN von außen brauchst.

## Fehlerbehebung

- **„Benutzername oder Passwort abgelehnt (oder Zwei-Faktor-Authentifizierung
  aktiv)“**: Prüfe den Benutzernamen (v15) und das Passwort. wg-easy v15
  verweigert einem Benutzer mit Zwei-Faktor-Authentifizierung den Zugriff auf
  die API per Passwort: Lege für Gladys einen Benutzer ohne an.
- **„Zugriff verweigert: Passwort-Anmeldung oder Benutzer deaktiviert“**: Der
  Benutzer ist deaktiviert, oder wg-easy läuft mit `DISABLE_PASSWORD_AUTH`.
- **„die Adresse leitet um“**: Die Adresse antwortet mit einer Umleitung,
  meist von HTTP auf HTTPS: Gib die `https://`-Adresse ein.
- **„Zertifikat abgelehnt“**: Aktiviere **Selbstsignierte Zertifikate
  akzeptieren**.
- **„keine wg-easy-API unter dieser Adresse“**: Die Adresse ist nicht die der
  Weboberfläche von wg-easy (prüfe den Port, standardmäßig 51821).
- **Ein Client bleibt „Verbunden: Nein“, obwohl sein Tunnel an ist**: Er sendet
  nichts. Stelle in wg-easy für diesen Client ein _Persistent keepalive_ (25 s)
  ein, wenn er auch im Ruhezustand als verbunden gelten soll.
- **Es fehlen Clients**: Ein wg-easy-Benutzer ohne Admin-Rechte sieht nur seine
  eigenen Clients: Verwende einen Admin.

## Grenzen

- Ein wg-easy-Server pro Gladys.
- Nur wg-easy v15 und v14; ältere Versionen werden nicht unterstützt.
- „Verbunden“ wird aus dem letzten Handshake abgeleitet (3 Minuten): Ein
  Client, der nichts sendet, gilt als getrennt; eine Trennung wird bis zu
  3 Minuten plus eine Abfrage später erkannt.
- Das Datum des letzten Handshakes stammt von der Uhr von wg-easy, die
  3 Minuten zählt die Uhr von Gladys: Halte beide genau (NTP).
- Die Datenzähler beginnen bei einem Neustart von wg-easy wieder bei null.
- Die Integration legt keine Clients an, löscht oder benennt keine um und zeigt
  keinen QR-Code: Das bleibt in wg-easy.
- Nicht mit wg-easy oder WireGuard verbunden. WireGuard ist eine eingetragene
  Marke von Jason A. Donenfeld.
