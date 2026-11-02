# SnapTrack

Ein schlankes Express-Grundgerüst mit EJS, SQLite und getrennten Benutzerkonten. Es gibt bewusst keine öffentliche Registrierung; Konten werden lokal angelegt.

## Einrichtung

Voraussetzung: Node.js ab Version 20 und npm. Für native Abhängigkeiten können plattformspezifische Build-Werkzeuge erforderlich sein.

1. `npm install` ausführen.
2. `.env.example` nach `.env` kopieren und `SESSION_SECRET` auf einen zufälligen Wert mit mindestens 32 Zeichen setzen, z. B. mit `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` erzeugen.
3. Mit `npm run create-user` ein Konto anlegen; für weitere Konten wiederholen. Die Passworteingabe ist im Terminal sichtbar.
4. Mit `npm start` starten und `http://localhost:3000` öffnen.

Die Datenbanken entstehen automatisch unter `data/`. Sessions bleiben bis zu 30 Tage und über Browser- und Serverneustarts erhalten. Abmelden löscht die Session. Das Session-Secret muss über Neustarts hinweg gleich bleiben. Benutzer und Sessions sollten regelmäßig gesichert werden.

Nach der Anmeldung lassen sich Snapchat-Profile unter „Accounts verwalten“ hinzufügen, bearbeiten und nach Bestätigung löschen. Benutzernamen dürfen 3 bis 30 Zeichen lang sein und Buchstaben, Zahlen, Punkte, Unterstriche und Bindestriche enthalten. Ein Name kann pro App-Konto nur einmal gespeichert werden; die Existenz des Snapchat-Profils wird nicht überprüft. Profile sind dem jeweiligen App-Konto zugeordnet.

Snapscores können auf dem Dashboard und der Profilseite manuell erfasst werden. Jeder gespeicherte Wert bleibt im Score-Verlauf erhalten; beim Löschen eines Accounts wird auch sein Verlauf gelöscht. Werte müssen nicht negative ganze Zahlen bis 9.007.199.254.740.991 sein. Zeitpunkte werden in UTC gespeichert und im Browser in der lokalen Zeitzone angezeigt. Es besteht keine automatische Verbindung zu Snapchat.

Auf der Profilseite zeigen „Liste“, „Verlauf“, „Fakten“ und „Tracking“ die gespeicherten Einträge und daraus berechnete Auswertungen. Einträge können in der Liste korrigiert oder nach Bestätigung gelöscht werden. Tagesgrenzen für Auswertungen und Streaks verwenden die Zeitzone Europe/Berlin. Für Muster gelten Mindestanforderungen; längere Messlücken und negative Veränderungen werden nicht als Aktivität interpretiert. Die automatisierten Prüfungen lassen sich mit `npm test` ausführen.

Auf dem iPhone kann SnapTrack in Safari über „Teilen“ und „Zum Home-Bildschirm“ als App hinzugefügt werden. Dafür ist HTTPS erforderlich (lokal ist `localhost` möglich). Der Service Worker speichert ausschließlich freigegebene statische Dateien; für Anmeldung und persönliche Daten wird weiterhin eine Verbindung benötigt. Neue Scores dürfen nicht unter dem zuletzt gespeicherten Wert liegen. Ein gerade gespeicherter Eintrag kann für 30 Sekunden rückgängig gemacht werden.

Statische Dateien tragen eine aus ihrem Inhalt abgeleitete Versionsnummer und werden im Browser sowie im Service Worker zwischengespeichert. Ein neuer Service Worker wird nach dem Schließen vorhandener App-Fenster aktiviert; HTML und persönliche Daten werden nicht im Service Worker gespeichert. Statistikberechnungen liegen begrenzt im Arbeitsspeicher (höchstens 128 Einträge beziehungsweise 8 MiB anhand der serialisierten Größe, maximal 60 Sekunden; Diagramme 15 Sekunden). Datenbankrevisionen sorgen auch bei Änderungen durch andere Prozesse für neue Cache-Schlüssel. Der Listenverlauf zeigt 50 Einträge pro Seite; Diagrammdaten werden je gewähltem Zeitraum nachgeladen.

Für den Produktivbetrieb `NODE_ENV=production` setzen und HTTPS verwenden; sichere Cookies werden dann nur über HTTPS übertragen. Hinter genau einem vertrauenswürdigen Reverse-Proxy `TRUST_PROXY=1` setzen und direkten Zugriff auf die Anwendung verhindern. Der Anmeldeschutz zählt Versuche pro IP im Arbeitsspeicher und gilt daher pro Prozess; für mehrere Instanzen ist ein gemeinsamer Rate-Limit-Speicher nötig.

Bei der Anmeldung werden IP-Adresse und eine grobe Geräte- und Browserkennung in der jeweiligen Session gespeichert und Administratoren in der Sitzungsübersicht angezeigt. Angaben für ältere Sessions können fehlen. Die Gerätekennung stammt aus dem vom Browser gesendeten User-Agent und ist nicht zuverlässig überprüfbar. Die Client-IP hängt von der korrekten Reverse-Proxy-Konfiguration ab. Eine Standortbestimmung ist nicht eingerichtet; es werden keine IP-Adressen an einen externen Geo-Dienst übertragen.

## Struktur

`src/controllers` enthält die Abläufe, `src/models` den Datenzugriff, `src/routes` die Routen, `src/middleware` die Zugriffsprüfung und `src/views` die EJS-Oberfläche. Geschützte Routen verwenden `requireAuth`; spätere nutzerspezifische Daten müssen bei jeder Abfrage anhand der angemeldeten Nutzer-ID gefiltert werden.

## Administration – bisheriger Umfang

Mit `npm run create-admin -- BENUTZERNAME` kann lokal ein vorhandener aktiver Nutzer zum ersten Administrator ernannt werden. Der Befehl funktioniert nur, solange noch kein Administrator existiert. Weitere Rollen- und Statusänderungen erfolgen im Admin-Bereich nach Eingabe des Administrator-Passworts und einer Begründung. Mindestens ein aktiver Administrator muss erhalten bleiben. Die Migration ergänzt vorhandene Nutzer automatisch mit der Rolle `user` und dem Status `active`.

Administratoren können unter „Nutzer“ weitere Konten mit einem Startpasswort anlegen. Optional lassen sich die Passwortanforderungen für das Startpasswort überspringen und eine Passwortänderung beim ersten Login verlangen. Das Startpasswort muss dem Nutzer über einen sicheren Kanal mitgeteilt werden; es wird nicht im Audit-Log gespeichert. Wiederherstellungen und Streak-Ausnahmen benötigen keine erneute Passworteingabe; sicherheitskritische Aktionen wie endgültiges Löschen verlangen sie weiterhin.

App-Nutzer können ihren Account in den Accounteinstellungen löschen; Administratoren können dies auf der Nutzerseite tun. Die Löschung beendet bestehende Sitzungen und gibt den Benutzernamen frei, bewahrt aber den Nutzer und seine Daten zur Wiederherstellung auf. Unter „Nutzer → Gelöschte Nutzer“ kann der Support den Account wiederherstellen. Ist der ursprüngliche Name inzwischen vergeben, muss ein neuer Name gewählt werden. Mindestens ein aktiver Administrator muss erhalten bleiben.

Der Admin-Bereich bietet Nutzer- und Account-Einsicht, ein Audit-Log, interne Support-Notizen, Rollen- und Statusänderungen, eine schreibgeschützte Datenprüfung sowie eine SQLite-Schnellprüfung. 2FA ist noch nicht implementiert. Fehler- und Backup-Historie werden derzeit nicht erfasst und als nicht verfügbar angezeigt.

Snapchat-Accounts und Score-Einträge werden beim normalen Löschen als gelöscht markiert und können im Support-Bereich wiederhergestellt oder ausdrücklich endgültig gelöscht werden. `DELETED_RETENTION_DAYS` legt die Aufbewahrungsfrist fest (Standard 30 Tage); eine automatische Bereinigung ist nicht eingerichtet. `npm run purge-expired -- --confirm` entfernt ausdrücklich nur abgelaufene Snapchat-Accounts und Score-Einträge endgültig und protokolliert die Bereinigung; gelöschte App-Nutzer werden dadurch nicht entfernt. Vorher ein Backup prüfen. Der Name eines gelöschten Snapchat-Accounts bleibt bis zur endgültigen Löschung für denselben Nutzer reserviert. Passwort-Reset-Links erfordern eine vertrauenswürdige HTTPS-Adresse in `PUBLIC_BASE_URL` (für lokale Tests ist `http://localhost:3000` möglich), sind 30 Minuten gültig und einmalig verwendbar. Bei Passwortwechsel werden andere Sessions ungültig.

**Noch nicht implementiert:** Admin-2FA und eine vollständige schreibgeschützte Vorschau der Nutzeroberfläche. Die Datenprüfung erkennt ungültige Einträge, sinkende Score-Intervalle und Fremdschlüsselverletzungen; Fehlerhistorie und fachliche Duplikaterkennung fehlen. Vor einem Produktiveinsatz sollten Admin-2FA, verlässliche Backups und eine automatische oder dokumentierte Bereinigung abgelaufener Datensätze ergänzt werden.
