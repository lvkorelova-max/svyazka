import { UserRole, UserStatus } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  status: UserStatus;
  sessionVersion: number;
  tokenType: 'access';
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword?: boolean;
  mfaEnabled?: boolean;
}
