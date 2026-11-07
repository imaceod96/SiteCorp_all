import { AuthUser, UserId } from "../domain";

export interface LoginDto {
  readonly email: string;
  readonly password: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface LoginResult {
  readonly user: AuthUser;
  readonly accessToken: string;
  readonly tokenType: "Bearer";
  readonly expiresInSeconds: number;
  readonly refreshToken: string | null;
  readonly sessionId: string;
  readonly sessionExpiresAt: Date;
  readonly refreshTokenExpiresAt: Date | null;
  readonly mustChangePassword: boolean;
}

export interface RefreshSessionDto {
  readonly rawRefreshToken: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface RefreshSessionResult {
  readonly accessToken: string;
  readonly tokenType: "Bearer";
  readonly expiresInSeconds: number;
  readonly newRefreshToken: string;
  readonly sessionId: string;
  readonly sessionExpiresAt: Date;
  readonly refreshTokenExpiresAt: Date;
}

export interface LogoutDto {
  readonly sessionId?: string;
  readonly rawRefreshToken?: string;
  readonly userId?: UserId;
  readonly allDevices?: boolean;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface ChangePasswordDto {
  readonly userId: UserId;
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface AdminCreateUserDto {
  readonly email: string;
  readonly initialPassword?: string;
  readonly mustChangePassword?: boolean;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface AdminUpdateStatusDto {
  readonly userId: UserId;
  readonly status: "active" | "suspended" | "deleted";
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

