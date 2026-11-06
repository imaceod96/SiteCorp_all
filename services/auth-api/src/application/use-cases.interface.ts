import { AuthUser } from "../domain";
import { AuthenticatedPrincipal } from "../interfaces";
import {
  LoginDto,
  LoginResult,
  RefreshSessionDto,
  RefreshSessionResult,
  LogoutDto,
  ChangePasswordDto,
  AdminCreateUserDto,
  AdminUpdateStatusDto,
} from "./dto";

export interface ILoginUseCase {
  execute(dto: LoginDto): Promise<LoginResult>;
}

export interface IRefreshSessionUseCase {
  execute(dto: RefreshSessionDto): Promise<RefreshSessionResult>;
}

export interface ILogoutUseCase {
  execute(dto: LogoutDto): Promise<void>;
}

export interface IChangePasswordUseCase {
  execute(dto: ChangePasswordDto): Promise<void>;
}

export interface IAdminCreateUserUseCase {
  execute(dto: AdminCreateUserDto, operator?: AuthenticatedPrincipal): Promise<AuthUser>;
}

export interface IAdminUpdateStatusUseCase {
  execute(dto: AdminUpdateStatusDto, operator?: AuthenticatedPrincipal): Promise<AuthUser>;
}
