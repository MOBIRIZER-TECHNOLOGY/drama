import { colors, spacing } from "@katha/tokens";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Button, Divider, Screen, Text, TextInput } from "@/components/ui";
import { useLegalLinks } from "@/hooks/use-legal-links";
import { useT } from "@/hooks/use-translations";
import { firebaseConfigured } from "@/lib/firebase";
import { googleIdToken, googleSignInAvailable } from "@/lib/google-signin";
import { firebaseErrorMessage, useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

type Mode = "sign_in" | "sign_up";
type Busy = "email" | "google" | "apple" | null;

function randomNonce(): string {
  return Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function AuthScreen() {
  const t = useT();
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { config } = useConfig();
  const { status, signInWithEmail, signUpWithEmail, sendPasswordReset, signInWithGoogleIdToken, signInWithApple } = useAuth();
  const { openPrivacy, openTerms } = useLegalLinks();
  const [mode, setMode] = useState<Mode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Per-field problems, checked here rather than by the server.
   *
   * A typo in an email address came back as "Invalid credentials" after a round trip, which reads as "your
   * password is wrong" and sends people to the reset flow for a mistake they could have seen immediately.
   * Shown only after a field has been left, so nothing is red while it is still being typed.
   */
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({});
  const [appleAvailable, setAppleAvailable] = useState(false);
  // Whether this modal itself signed the user in; only then may it navigate to `returnTo`.
  const signedInHere = useRef(false);

  /** Close: the user backed out. Never navigates anywhere else. */
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [router]);

  /** Success: back to where the user was, or to `returnTo` when the caller needs specific state. */
  const succeed = useCallback(() => {
    if (returnTo) router.replace(returnTo as Href);
    else close();
  }, [returnTo, router, close]);

  useEffect(() => {
    // Opened while already signed in (or signed in elsewhere): just close, do not bounce to returnTo.
    if (status === "signed_in" && !signedInHere.current) close();
  }, [status, close]);

  useEffect(() => {
    if (Platform.OS !== "ios" || config.auth.apple === false) return;
    AppleAuthentication.isAvailableAsync()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
  }, [config.auth.apple]);

  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(
    async (kind: Exclude<Busy, null>, action: () => Promise<boolean>) => {
      setError(null);
      setBusy(kind);
      try {
        const done = await action();
        if (done) {
          signedInHere.current = true;
          succeed();
        }
      } catch (e) {
        setError(firebaseErrorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [succeed],
  );

  // Deliberately permissive: the only addresses worth rejecting here are ones that cannot be an address at
  // all. Anything stricter rejects real people, and the server verifies for real anyway.
  const emailProblem = !email.trim()
    ? t("auth.email_required")
    : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
      ? t("auth.email_invalid")
      : null;
  // Length is only enforced on sign-up: an existing account may predate any rule we have today, and telling
  // someone their real password is too short is the worst possible time to be wrong.
  const passwordProblem = !password
    ? t("auth.password_required")
    : mode === "sign_up" && password.length < 8
      ? t("auth.password_short")
      : null;

  const submitEmail = useCallback(() => {
    setTouched({ email: true, password: true });
    if (emailProblem || passwordProblem) return;
    void run("email", async () => {
      if (mode === "sign_in") await signInWithEmail(email, password);
      else await signUpWithEmail(email, password, name);
      return true;
    });
  }, [email, password, name, mode, run, signInWithEmail, signUpWithEmail, emailProblem, passwordProblem]);

  /**
   * Sends a reset link and confirms it in place.
   *
   * Deliberately not routed through `run`: that helper closes the screen on success, and here the viewer has
   * to stay and read the confirmation. The same message shows whether or not the address has an account, so
   * the form cannot be used to find out which emails are registered.
   */
  const resetPassword = useCallback(() => {
    setTouched((prev) => ({ ...prev, email: true }));
    if (emailProblem) return;
    setError(null);
    setNotice(null);
    setBusy("email");
    void (async () => {
      try {
        await sendPasswordReset(email);
        setNotice(t("auth.reset_sent"));
      } catch (e) {
        setError(firebaseErrorMessage(e));
      } finally {
        setBusy(null);
      }
    })();
  }, [email, emailProblem, sendPasswordReset, t]);

  const startGoogle = useCallback(() => {
    void run("google", async () => {
      const idToken = await googleIdToken();
      // Null means the sheet was dismissed. Nothing went wrong, so nothing is reported.
      if (!idToken) return false;
      await signInWithGoogleIdToken(idToken);
      return true;
    });
  }, [run, signInWithGoogleIdToken]);

  const startApple = useCallback(() => {
    void run("apple", async () => {
      const rawNonce = randomNonce();
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      let credential: AppleAuthentication.AppleAuthenticationCredential;
      try {
        credential = await AppleAuthentication.signInAsync({
          requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
          nonce: hashedNonce,
        });
      } catch (e) {
        if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "ERR_REQUEST_CANCELED") return false;
        throw e;
      }
      if (!credential.identityToken) throw new Error("Apple did not return an identity token");
      await signInWithApple(credential.identityToken, rawNonce);
      return true;
    });
  }, [run, signInWithApple]);

  const emailEnabled = config.auth.email !== false;
  const googleEnabled = config.auth.google !== false && googleSignInAvailable();
  const appleEnabled = Platform.OS === "ios" && config.auth.apple !== false && appleAvailable;
  const phoneEnabled = config.auth.phone !== false;

  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={12}>
              <Icon name="close" size={26} />
            </Pressable>
          </View>
          <Text variant="display">{mode === "sign_in" ? t("auth.sign_in") : t("auth.sign_up")}</Text>
          <Text variant="body">Your coins, list and progress follow you across devices.</Text>

          {!firebaseConfigured() ? (
            <Text variant="caption" color={colors.warning}>
              Firebase is not configured for this build (EXPO_PUBLIC_FIREBASE_* or config.firebase). Sign-in will fail until it is.
            </Text>
          ) : null}

          {emailEnabled ? (
            <View style={styles.form}>
              {mode === "sign_up" ? (
                <TextInput placeholder={t("auth.name_label")} value={name} onChangeText={setName} autoCapitalize="words" textContentType="name" />
              ) : null}
              <TextInput
                placeholder={t("auth.email_label")}
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  setError(null);
                }}
                onBlur={() => setTouched((s) => ({ ...s, email: true }))}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
              />
              {touched.email && emailProblem ? (
                <Text variant="caption" color={colors.danger}>
                  {emailProblem}
                </Text>
              ) : null}
              <TextInput
                placeholder={t("auth.password_label")}
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  setError(null);
                }}
                onBlur={() => setTouched((s) => ({ ...s, password: true }))}
                secureTextEntry
                textContentType={mode === "sign_up" ? "newPassword" : "password"}
                autoComplete={mode === "sign_up" ? "new-password" : "password"}
                onSubmitEditing={submitEmail}
                returnKeyType="go"
              />
              {touched.password && passwordProblem ? (
                <Text variant="caption" color={colors.danger}>
                  {passwordProblem}
                </Text>
              ) : null}
              {error ? (
                <Text variant="caption" color={colors.danger}>
                  {error}
                </Text>
              ) : null}
              <Button
                title={mode === "sign_in" ? t("auth.sign_in") : t("auth.sign_up")}
                onPress={submitEmail}
                loading={busy === "email"}
                disabled={busy !== null}
              />
              {notice ? (
                <Text variant="caption" color={colors.success}>
                  {notice}
                </Text>
              ) : null}
              {mode === "sign_in" ? (
                <Pressable onPress={resetPassword} accessibilityRole="button" style={styles.forgot} disabled={busy !== null}>
                  <Text variant="caption" color={colors.accent}>
                    {t("auth.forgot_password")}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => {
                  setMode((m) => (m === "sign_in" ? "sign_up" : "sign_in"));
                  setError(null);
                  setTouched({});
                }}
                accessibilityRole="button"
                style={styles.switch}
              >
                <Text variant="caption">
                  {mode === "sign_in" ? "New here? " : "Already have an account? "}
                  <Text variant="caption" color={colors.accent}>
                    {mode === "sign_in" ? t("auth.sign_up") : t("auth.sign_in")}
                  </Text>
                </Text>
              </Pressable>
            </View>
          ) : null}

          {!emailEnabled && error ? (
            <Text variant="caption" color={colors.danger}>
              {error}
            </Text>
          ) : null}

          {/*
            Required by both stores and by the privacy policy itself, and it was missing: the app collected an
            account without ever telling anyone what they were agreeing to. Placed above the alternative
            providers so it covers every route in, not only the email form.
          */}
          <Text variant="caption" style={styles.consent}>
            {t("auth.by_continuing")}{" "}
            <Text variant="caption" color={colors.accent} onPress={openTerms}>
              {t("me.terms")}
            </Text>
            {" "}
            {t("auth.and")}{" "}
            <Text variant="caption" color={colors.accent} onPress={openPrivacy}>
              {t("me.privacy")}
            </Text>
          </Text>

          {(googleEnabled || appleEnabled || phoneEnabled) && emailEnabled ? (
            <View style={styles.orRow}>
              <Divider style={{ flex: 1 }} />
              <Text variant="caption">or</Text>
              <Divider style={{ flex: 1 }} />
            </View>
          ) : null}

          {appleEnabled ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={12}
              style={styles.appleButton}
              onPress={startApple}
            />
          ) : null}

          {googleEnabled ? (
            <Button title={t("auth.google")} variant="secondary" onPress={startGoogle} loading={busy === "google"} disabled={busy !== null} />
          ) : null}

          {phoneEnabled ? (
            // TODO(phase 2): phone OTP needs the native Firebase SDK (react-native-firebase) because the JS SDK's
            // reCAPTCHA verifier is web-only. Wire signInWithPhoneNumber + confirm() here once the dev client ships.
            <View>
              <Button title={t("auth.phone_cta")} variant="ghost" disabled />
              <Text variant="caption" style={styles.todo}>
                Phone sign-in arrives with the native build (phase 2).
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.lg },
  header: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: spacing.sm },
  form: { gap: spacing.md, marginTop: spacing.sm },
  switch: { alignSelf: "center", paddingVertical: spacing.sm },
  forgot: { alignSelf: "center", paddingVertical: spacing.xs },
  consent: { textAlign: "center", marginTop: spacing.md },
  orRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  appleButton: { height: 48, width: "100%" },
  todo: { textAlign: "center", marginTop: spacing.xs },
});
