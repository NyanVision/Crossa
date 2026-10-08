# Native authentication checks

After completing BACKEND-SETUP.md, use a development build on iOS and Android:

1. Register with a test email you control. No onboarding should open before
   confirmation when email confirmation is enabled.
2. Open the confirmation email on the same device that requested it (PKCE).
   Alternatively confirm on another device and then sign in normally.
3. Complete About You and profile setup. Check the name, bio, social links and
   photo after restarting, signing out/in, and signing in on another device.
4. Verify invalid passwords give an error. Close/reopen to verify session restore.
5. Reset a password and open the recovery link on the requesting device. The
   new-password form must appear even for an already-onboarded user. Verify the
   new password works and the old password is rejected.
6. Enable/configure Google; check success and cancellation without fake accounts.
7. With two test users, verify neither can read/update the other's profile,
   private preferences, hidden social links or avatar objects through the API.
8. Delete one test account from Settings. Confirm its Auth user, profile and
   avatar objects are removed and its saved session cannot read/write data.

Native interactive tests have not yet been run. Type checking, linting and
server-side access tests are automated checks, not a substitute for these flows.
Legacy device-only test credentials are cleared and never accepted as real login.
