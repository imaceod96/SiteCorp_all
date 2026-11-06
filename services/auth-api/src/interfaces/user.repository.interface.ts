import { AuthUser, Email, UserId } from "../domain";

export interface IUserRepository {
  findById(id: UserId): Promise<AuthUser | null>;
  findByEmail(email: Email): Promise<AuthUser | null>;
  save(user: AuthUser): Promise<void>;
  update(user: AuthUser): Promise<void>;
  delete(id: UserId): Promise<void>;
}
