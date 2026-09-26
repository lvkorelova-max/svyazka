import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PartnershipsController } from './partnerships.controller';

describe('PartnershipsController responsibility endpoint', () => {
  it('allows only BRAND and MANAGER roles', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      PartnershipsController.prototype.updateResponsibility,
    );

    expect(roles).toEqual([UserRole.BRAND, UserRole.MANAGER]);
    expect(roles).not.toContain(UserRole.ADMIN);
    expect(roles).toHaveLength(2);
  });
});
