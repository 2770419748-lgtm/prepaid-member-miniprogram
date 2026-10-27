import { Module } from '@nestjs/common';
import { STAFF_ROLES } from 'shared';

/**
 * 账号与鉴权边界。
 * TODO(M1): 微信登录、JWT（JWT_SECRET）、角色鉴权。
 * 角色预留：SUPER_ADMIN / STORE_MANAGER / STAFF。本里程碑无登录实现。
 */
export const AUTH_STAFF_ROLES = STAFF_ROLES;

@Module({})
export class AuthModule {}
