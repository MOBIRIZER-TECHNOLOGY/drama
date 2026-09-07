import { colors, spacing } from "@katha/tokens";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icons";
import { Button, Divider, Screen, Text, TextInput } from "@/components/ui";
import { useT } from "@/hooks/use-translations";
import { firebaseConfigured, googleClientIds, googleConfigured } from "@/lib/firebase";
import { firebaseErrorMessage, useAuth } from "@/providers/auth";
import { useConfig } from "@/providers/config";

type Mode = "sign_in" | "sign_up";
type Busy = "email" | "google" | "apple" | null;

let googleConfiguredOnce = false;
function configureGoogle() {
  if (googleConfiguredOnce || !googleConfigured) return;
  GoogleSignin.configure({ webClientId: googleClientIds.webClientId, iosClientId: googleClientIds.iosClientId });
  googleConfiguredOnce = true;
}

function randomNonce(): string {
  return Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function AuthScreen() {
  const t = useT();
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { config } = useConfig();
  const { status, signInWithEmail, signUpWithEmail, signInWithGoogleIdToken, signInWithApple } = useAuth();
  const [mode, setMode] = useState<Mode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
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

  const submitEmail = useCallback(() => {
    if (!email.trim() || !password) {
      setError("Enter your email and password");
      return;
    }
    void run("email", async () => {
      if (mode === "sign_in") await signInWithEmail(email, password);
      else await signUpWithEmail(email, password, name);
      return true;
    });
  }, [email, password, name, mode, run, signInWithEmail, signUpWithEmail]);

  const startGoogle = useCallback(() => {
    void run("google", async () => {
      configureGoogle();
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      if (result.type !== "success") return false;
      const idToken = result.data.idToken;
      if (!idToken) throw new Error("Google did not return an ID token");
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
  const googleEnabled = config.auth.google !== false && googleConfigured;
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
                <TextInput placeholder="Display name (optional)" value={name} onChangeText={setName} autoCapitalize="words" textContentType="name" />
              ) : null}
              <TextInput
                placeholder="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
              />
              <TextInput
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType={mode === "sign_up" ? "newPassword" : "password"}
                autoComplete={mode === "sign_up" ? "new-password" : "password"}
                onSubmitEditing={submitEmail}
                returnKeyType="go"
              />
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
              <Pressable
                onPress={() => {
                  setMode((m) => (m === "sign_in" ? "sign_up" : "sign_in"));
                  setError(null);
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
  orRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  appleButton: { height: 48, width: "100%" },
  todo: { textAlign: "center", marginTop: spacing.xs },
});
