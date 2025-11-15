import fs from "fs";
import path from "path";
import admin from "firebase-admin";

let firebaseApp: admin.app.App | null = null;

const loadServiceAccount = () => {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : path.resolve(process.cwd(), "ServiceAccountKey.json");

  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`Service account file not found at ${credentialsPath}`);
  }

  const fileContents = fs.readFileSync(credentialsPath, "utf-8");
  return JSON.parse(fileContents);
};

const getFirebaseApp = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  const serviceAccount = loadServiceAccount() as admin.ServiceAccount;

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return firebaseApp;
};

export const verifyIdToken = async (token: string) => {
  if (!token) {
    throw new Error("Missing token");
  }

  const app = getFirebaseApp();
  const auth = app.auth();
  return auth.verifyIdToken(token, true);
};

export const createSessionCookie = async (idToken: string, expiresIn: number) => {
  const app = getFirebaseApp();
  const auth = app.auth();
  return auth.createSessionCookie(idToken, { expiresIn });
};

export const verifySessionCookie = async (sessionCookie: string) => {
  const app = getFirebaseApp();
  const auth = app.auth();
  return auth.verifySessionCookie(sessionCookie, true);
};

export const revokeRefreshTokens = async (uid: string) => {
  const app = getFirebaseApp();
  const auth = app.auth();
  return auth.revokeRefreshTokens(uid);
};
