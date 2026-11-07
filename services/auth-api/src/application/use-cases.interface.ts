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
  GenerateActivationTokenDto,
  GenerateActivationTokenResult,
  ConsumeActivationTokenDto,
  ConsumeActivationTokenResult,
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

export interface IGenerateActivationTokenUseCase {
  execute(
    dto: GenerateActivationTokenDto,
    operator?: AuthenticatedPrincipal
  ): Promise<GenerateActivationTokenResult>;
}

export interface IConsumeActivationTokenUseCase {
  execute(dto: ConsumeActivationTokenDto): Promise<ConsumeActivationTokenResult>;
}

