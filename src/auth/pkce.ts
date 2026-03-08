import crypto from "node:crypto";

export interface PkceChallenge {
  verifier: string;
  challenge: string;
  method: "S256";
}

export function generatePkce(): PkceChallenge {
  const verifier = crypto.randomBytes(96).toString("base64url").slice(0, 128);
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");

  return { verifier, challenge, method: "S256" };
}

export function generateState(): string {
  return crypto.randomBytes(24).toString("base64url").slice(0, 32);
}
