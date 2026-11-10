export interface IPasswordHasher {
  readonly algorithm: "argon2id" | "bcrypt";
  hash(plainText: string): Promise<string>;
  verify(plainText: string, hash: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
}
