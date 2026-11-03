# Client patches

The release ships only the minified client (`client/dist/assets/*.js`). Every edit to it is listed here: the file,
the exact text replaced (the anchor), what replaced it, and why. After an edit, run
`python3 scripts/rehash_client.py assets/<file>` so the changed chunk (and every chunk that imports it) gets a new
content-hashed name.

A new release of the client will drop these patches; re-apply them from this list.

_No patches yet (Phase 0 changed nothing in the client)._
