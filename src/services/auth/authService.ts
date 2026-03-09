import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import env from "../../config/env";

export interface TokenPayload {
    uid: string;
    email?: string;
}

export const authService = {
    async hashPassword(password: string): Promise<string> {
        const saltRounds = 10;
        return bcrypt.hash(password, saltRounds);
    },

    async comparePassword(password: string, hash: string): Promise<boolean> {
        return bcrypt.compare(password, hash);
    },

    generateToken(payload: TokenPayload): string {
        return jwt.sign(payload, env.jwt.secret, {
            expiresIn: env.jwt.expiresIn as any,
        });
    },

    verifyToken(token: string): TokenPayload {
        try {
            return jwt.verify(token, env.jwt.secret) as TokenPayload;
        } catch (error) {
            throw new Error("Invalid or expired token");
        }
    },
};
