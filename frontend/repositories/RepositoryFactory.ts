// repositories/RepositoryFactory.ts
// Sprint 14A — Backend Foundation
// Single access point for all repositories (singleton instances).
// Future: this is where a Prisma-backed variant gets swapped in.

import { UserRepository } from "./UserRepository";
import { ProductRepository } from "./ProductRepository";
import { ConversationRepository } from "./ConversationRepository";
import { AgentRepository } from "./AgentRepository";
import { AutomationRepository } from "./AutomationRepository";
import { KnowledgeRepository } from "./KnowledgeRepository";
import { BillingRepository } from "./BillingRepository";

export class RepositoryFactory {
  private static _users: UserRepository | null = null;
  private static _products: ProductRepository | null = null;
  private static _conversations: ConversationRepository | null = null;
  private static _agents: AgentRepository | null = null;
  private static _automations: AutomationRepository | null = null;
  private static _knowledge: KnowledgeRepository | null = null;
  private static _billing: BillingRepository | null = null;

  static users(): UserRepository {
    if (!this._users) this._users = new UserRepository();
    return this._users;
  }

  static products(): ProductRepository {
    if (!this._products) this._products = new ProductRepository();
    return this._products;
  }

  static conversations(): ConversationRepository {
    if (!this._conversations)
      this._conversations = new ConversationRepository();
    return this._conversations;
  }

  static agents(): AgentRepository {
    if (!this._agents) this._agents = new AgentRepository();
    return this._agents;
  }

  static automations(): AutomationRepository {
    if (!this._automations) this._automations = new AutomationRepository();
    return this._automations;
  }

  static knowledge(): KnowledgeRepository {
    if (!this._knowledge) this._knowledge = new KnowledgeRepository();
    return this._knowledge;
  }

  static billing(): BillingRepository {
    if (!this._billing) this._billing = new BillingRepository();
    return this._billing;
  }
}
