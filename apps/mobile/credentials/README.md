# Signing credentials

`release.keystore` signs the Android release builds. **It is not in version control and must not be.**
Anyone holding it can publish an update that Android will accept as genuine Katha, and Google Play ties a
listing to one signing identity for the life of the app: lose this file and the listing cannot be updated
by anyone, ever — the only remedy is a new listing and every existing install stranded.

Back it up somewhere durable and private before the first store upload, and keep the passwords with it.

    alias:      katha
    store pass: katha-release
    key pass:   katha-release

Those passwords are development defaults, fine for sideloading a test build and not fine for a store
release. Before the first upload, generate a fresh keystore with real passwords and keep them in a secret
manager rather than a file beside the key:

    keytool -genkeypair -v -keystore release.keystore -alias katha \
      -keyalg RSA -keysize 2048 -validity 10000

Better still, enrol in Play App Signing, which keeps the distribution key with Google and leaves you only
the upload key to protect.
