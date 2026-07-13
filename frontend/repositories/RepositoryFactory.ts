// repositories/RepositoryFactory.ts
// Sprint 14A - Single access point for all repositories (singleton instances).
// Sprint 14D - Dependency injection: resolves mock vs Prisma implementations
// from configuration. Callers are unchanged; only the wiring here decides.
import type { IRepository } from "@/types/backend";
import { resolveRepositoryMode } from "@/config/repository.config";

// --- entity types ---
import type { UserEntity } from "./UserRepository";
import type { ProductEntity } from "./ProductRepository";
import type { ConversationEntity } from "./ConversationRepository";
import type { AgentEntity } from "./AgentRepository";
import type { AutomationEntity } from "./AutomationRepository";
import type { KnowledgeEntity } from "./KnowledgeRepository";
import type { BillingEntity } from "./BillingRepository";

// --- mock implementations (Sprint 14A) ---
import { ProductRepository } from "./ProductRepository";
import { ConversationRepository } from "./ConversationRepository";
import { AgentRepository } from "./AgentRepository";
import { AutomationRepository } from "./AutomationRepository";
import { KnowledgeRepository } from "./KnowledgeRepository";
import { BillingRepository } from "./BillingRepository";

// --- Prisma implementations (Sprint 14C/14D) ---
import { UserRepository } from "./UserRepository"; // already Prisma-backed (14C)
import { PrismaProductRepository } from "./PrismaProductRepository";
import { PrismaConversationRepository } from "./PrismaConversationRepository";
import { PrismaAgentRepository } from "./PrismaAgentRepository";
import { PrismaAutomationRepository } from "./PrismaAutomationRepository";
import { PrismaKnowledgeRepository } from "./PrismaKnowledgeRepository";
import { PrismaBillingRepository } from "./PrismaBillingRepository";

// --- repository contracts (what callers rely on) ---
export interface IUserRepository extends IRepository<UserEntity> {
  findByEmail(email: string): Promise<UserEntity | null>;
}
export interface IProductRepository extends IRepository<ProductEntity> {}
export interface IConversationRepository
  extends IRepository<ConversationEntity> {
  findByUser(userId: string): Promise<ConversationEntity[]>;
}
export interface IAgentRepository extends IRepository<AgentEntity> {
  findByUser(userId: string): Promise<AgentEntity[]>;
}
export interface IAutomationRepository extends IRepository<AutomationEntity> {
  findByUser(userId: string): Promise<AutomationEntity[]>;
}
export interface IKnowledgeRepository extends IRepository<KnowledgeEntity> {
  findByUser(userId: string): Promise<KnowledgeEntity[]>;
}
export interface IBillingRepository extends IRepository<BillingEntity> {
  findByUser(userId: string): Promise<BillingEntity[]>;
}

export class RepositoryFactory {
  private static _users: IUserRepository | null = null;
  private static _products: IProductRepository | null = null;
  private static _conversations: IConversationRepository | null = null;
  private static _agents: IAgentRepository | null = null;
  private static _automations: IAutomationRepository | null = null;
  private static _knowledge: IKnowledgeRepository | null = null;
  private static _billing: IBillingRepository | null = null;

  // Active mode, resolved from configuration (mock | prisma | auto).
  static mode(): "mock" | "prisma" {
    return resolveRepositoryMode();
  }

  // Clears cached singletons. Used by tests or after a mode change.
  static reset(): void {
    this._users = null;
    this._products = null;
    this._conversations = null;
    this._agents = null;
    this._automations = null;
    this._knowledge = null;
    this._billing = null;
  }

  static users(): IUserRepository {
    // User persistence is Prisma-only since Sprint 14C (real auth).
    if (!this._users) this._users = new UserRepository();
    return this._users;
  }

  static products(): IProductRepository {
    if (!this._products) {
      this._products =
        this.mode() === "prisma"
          ? new PrismaProductRepository()
          : new ProductRepository();
    }
    return this._products;
  }

  static conversations(): IConversationRepository {
    if (!this._conversations) {
      this._conversations =
        this.mode() === "prisma"
          ? new PrismaConversationRepository()
          : new ConversationRepository();
    }
    return this._conversations;
  }

  static agents(): IAgentRepository {
    if (!this._agents) {
      this._agents =
        this.mode() === "prisma"
          ? new PrismaAgentRepository()
          : new AgentRepository();
    }
    return this._agents;
  }

  static automations(): IAutomationRepository {
    if (!this._automations) {
      this._automations =
        this.mode() === "prisma"
          ? new PrismaAutomationRepository()
          : new AutomationRepository();
    }
    return this._automations;
  }

  static knowledge(): IKnowledgeRepository {
    if (!this._knowledge) {
      this._knowledge =
        this.mode() === "prisma"
          ? new PrismaKnowledgeRepository()
          : new KnowledgeRepository();
    }
    return this._knowledge;
  }

  static billing(): IBillingRepository {
    if (!this._billing) {
      this._billing =
        this.mode() === "prisma"
          ? new PrismaBillingRepository()
          : new BillingRepository();
    }
    return this._billing;
  }
}
