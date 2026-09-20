# dockview-core (vendored)

`dockview-core.min.js` ist unverändert aus `node_modules/dockview-core/dist/` kopiert
(Version 8.3.1, MIT, https://github.com/dockview/dockview). Das UMD-Bundle bringt sein
CSS selbst mit und legt die API auf `window["dockview-core"]`.

Aktualisieren:

```sh
ocx exec -- pnpm up dockview-core
cp node_modules/dockview-core/dist/dockview-core.min.js public/vendor/dockview/
```

Bewusst vendored statt per CDN: der Planer soll ohne Netz starten und ohne Build-Schritt
auskommen. Es ist die einzige Fremdbibliothek im Planer — auf ausdrücklichen Wunsch,
weil ein Docking-Layout von Hand nicht mehr sinnvoll ist.
