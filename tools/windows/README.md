# Dashboard file icon test

This is an optional Windows prototype for the `.pboard` dashboard file type.
The file contains the existing ZIP-backed CSV, layout, and manifest. Board, Pack,
and Isometric can open `.pboard` and older `.zip` projects. Save still defaults to
`.zip` while this prototype is being evaluated.

Open a regular Windows PowerShell session outside Codex, change to the repository
root, and register the test icon for the current Windows account:

```powershell
powershell -File tools/windows/dashboard-icon-test.ps1
```

Run both setup and removal in that regular desktop session. Registry writes made
from some packaged apps can be isolated from Explorer. In that case, a script and
its Shell API tests may see the custom registration while Explorer still reports
`PBOARD File` and shows a blank icon. Repeating cache refreshes inside that app
does not install the association for Explorer.

The script associates `.pboard` with **Program Dashboard Project** and the local
`icons/dashboard-project-shell.ico`. The icon is assigned directly to the extension
and the prototype ProgID. It refuses to replace another registration or a
Windows user-selected handler. It creates no open command and changes no `.zip`
association. Open a test project with the dashboard's Browse button or drag-and-drop.
Double-click opening will need a separately installed app/PWA integration.

If an already-open Explorer view still shows a generic icon, refresh the actual
downloaded file as well as the file-type registration:

```powershell
powershell -File tools/windows/dashboard-icon-test.ps1 -RefreshFile "$env:USERPROFILE\Downloads\Dashboard-demo.pboard"
```

Then press F5 in that Explorer window if needed. The refresh sends Shell item and
folder notifications; it does not delete system icon caches or restart Explorer.

Shell API checks confirm icon extraction, not necessarily the image already
displayed by an open Explorer window. Verify a freshly downloaded `.pboard` in
Explorer at the intended icon size before calling the test successful.

The local Windows test was verified in the actual Downloads window on
2026-10-16: existing downloaded files display the four-cell dashboard icon in
both Details and Extra large icons views. The cause of the earlier blank icons
was an isolated registry view, not the ICO format or the project archive.

To undo the test:

```powershell
powershell -File tools/windows/dashboard-icon-test.ps1 -Remove
```

Removal checks exact names, values, and ownership before deleting the test keys;
if another app changed the registration, it leaves the keys alone. Keep the icon
file at its current location until removing the test registration. This script is
not part of the Netlify deploy package and never runs from the website.

The editable icon source is `icons/dashboard-project.svg`; the ICO contains
16, 24, 32, 48, 64, 128, and 256-pixel versions. The test import regressions run with
`node test-pboard-import.js`.
