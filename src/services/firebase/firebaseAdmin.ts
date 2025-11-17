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

  // Check if app already exists
  try {
    firebaseApp = admin.app();
    return firebaseApp;
  } catch (error) {
    // App doesn't exist, initialize it
    const serviceAccount = loadServiceAccount() as admin.ServiceAccount;
    
    // Extract project_id from service account
    const projectId = (serviceAccount as any).project_id || serviceAccount.projectId;
    
    if (!projectId) {
      throw new Error("Firebase project ID not found in service account file");
    }
    
    // Use environment variable if set, otherwise use default US region
    // For Asia region databases, set FIREBASE_DATABASE_URL in .env
    const databaseURL = process.env.FIREBASE_DATABASE_URL || `https://${projectId}-default-rtdb.firebaseio.com`;

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL,
    });

    return firebaseApp;
  }
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

export const getDatabase = () => {
  const app = getFirebaseApp();
  return app.database();
};

export const getFirestore = () => {
  const app = getFirebaseApp();
  return app.firestore();
};

export const firebaseAdmin = {
  verifyIdToken,
  createSessionCookie,
  verifySessionCookie,
  revokeRefreshTokens,
  getDatabase,
  getFirestore,
};

export default firebaseAdmin;
