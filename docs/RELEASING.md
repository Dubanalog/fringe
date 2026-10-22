# Releasing

GitHub Actions builds every installer and the PDF manual (`.github/workflows/release.yml`):

| Platform | Architectures        | Formats                        | Signed                  |
| -------- | -------------------- | ------------------------------ | ----------------------- |
| Windows  | x64, arm64           | Installer (.exe), .zip         | Not yet                 |
| macOS    | Apple Silicon, Intel | .dmg, .zip                     | Developer ID, notarized |
| Linux    | x64, arm64           | .AppImage, .deb, .rpm, .tar.gz | n/a                     |

## Making a release

1. Make sure `main` is green (the CI workflow).
2. Tag the version and push the tag:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. The workflow sets the app's version from the tag, builds on all platforms (about 20 minutes)
   and creates a **draft** release with every file attached.
4. Open the draft under Releases, check the notes, and click **Publish**.

To build without releasing, run **Build installers** from the Actions tab (Run workflow). The files
are under the run's Artifacts.

## Signing the Mac app (one-time setup)

Without these secrets the Mac build still works, but macOS warns that the app is from an
unidentified developer. With them, the app is signed with your Developer ID and notarized by Apple,
so it opens with no warning. GitHub's own Mac machines do the build; the Mac mini is only needed
once, to make the certificate.

You need a paid Apple Developer Program membership, and you must be its **Account Holder** to make
a Developer ID certificate.

### 1. Make a Developer ID certificate (on the Mac mini)

The easy way is with Xcode (free from the App Store):

1. Open **Xcode → Settings → Accounts**, click **+** and sign in with your Apple developer account.
2. Select your team, click **Manage Certificates…**, click **+** and choose **Developer ID
   Application**.

Or without Xcode:

1. Open **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate
   Authority…**. Enter your email, choose **Saved to disk**, and save the `.certSigningRequest`.
2. At [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates/list)
   click **+**, choose **Developer ID Application**, upload the request, then download the
   certificate and double-click it to add it to your keychain.

### 2. Export it

1. In **Keychain Access**, select the **login** keychain and **My Certificates**.
2. Find **Developer ID Application: _Your Name_ (_TEAMID_)**. Expand it to check there's a private
   key under it.
3. Right-click it → **Export…** → save as `DeveloperID.p12`, and choose a strong password. This is
   `MAC_CERTIFICATE_PASSWORD` below.

### 3. Get an app-specific password and your Team ID

- **App-specific password:** at [account.apple.com](https://account.apple.com), **Sign-In and
  Security → App-Specific Passwords**, make one named "Fringe notarization".
- **Team ID:** at [developer.apple.com/account](https://developer.apple.com/account), under
  **Membership details** (10 letters and numbers).

### 4. Add the GitHub secrets

In the repository on GitHub: **Settings → Secrets and variables → Actions → New repository
secret**, add:

| Secret                        | Value                                 |
| ----------------------------- | ------------------------------------- |
| `MAC_CERTIFICATE`             | The `.p12` file as base64 (see below) |
| `MAC_CERTIFICATE_PASSWORD`    | The password you gave the `.p12`      |
| `APPLE_ID`                    | Your Apple developer account's email  |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password from step 3 |
| `APPLE_TEAM_ID`               | Your Team ID                          |

To get the `.p12` as base64 on the Mac, in Terminal:

```bash
base64 -i ~/Desktop/DeveloperID.p12 | pbcopy
```

then paste into the secret. Or, with the GitHub CLI on the Mac, set it straight from the file:

```bash
base64 -i ~/Desktop/DeveloperID.p12 | gh secret set MAC_CERTIFICATE -R Dubanalog/fringe
```

Afterwards delete the `.p12` from the Desktop; the certificate stays in your keychain.

The next tagged build signs and notarizes the Mac app. Notarizing adds a few minutes. If it fails,
the run's log for the macOS job says why (most often a wrong app-specific password or Team ID).

## Signing for Windows (later)

Windows builds are unsigned, so SmartScreen warns on first launch (**More info → Run anyway**).
To sign later, add a code-signing certificate as `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets
(or use Azure Trusted Signing) and pass them to the Windows job.
