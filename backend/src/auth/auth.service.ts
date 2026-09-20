import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import type { CurrentUser } from './current-user.interface';

export interface MeResponse {
  id: string;
  name: string;
  role: string;
  organizationId: string;
}

export interface UserListItem {
  id: string;
  name: string;
  email: string;
  role: string;
  organizationId: string;
  organizationName: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** Returns the caller's identity — organisationId comes from DB via the guard. */
  getMe(currentUser: CurrentUser): MeResponse {
    return {
      id: currentUser.id,
      name: currentUser.name,
      role: currentUser.role,
      organizationId: currentUser.organizationId,
    };
  }

  /**
   * Returns all seeded users with their organization name.
   * Used to populate the login dropdown — no auth required.
   */
  async getAllUsers(): Promise<UserListItem[]> {
    const users = await this.userRepository.find({
      relations: ['organization'],
      order: { name: 'ASC' },
    });

    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      organizationId: u.organizationId,
      organizationName: u.organization.name,
    }));
  }
}
