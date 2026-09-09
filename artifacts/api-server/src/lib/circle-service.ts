import { and, eq } from "drizzle-orm";

export type CircleRepository = {
  insertMembership(ownerUserId: string, creatorId: string): Promise<void>;
  insertFollow(ownerUserId: string, creatorId: string): Promise<void>;
  deleteMembership(ownerUserId: string, creatorId: string): Promise<void>;
  transaction?<T>(work: (repo: CircleRepository) => Promise<T>): Promise<T>;
};

export function createDrizzleCircleRepository(database: {
  insert: (table: unknown) => { values: (value: unknown) => { onConflictDoNothing: () => Promise<unknown> } };
  delete: (table: unknown) => { where: (condition: unknown) => Promise<unknown> };
  transaction: (work: (tx: any) => Promise<any>) => Promise<any>;
}, tables: { memberships: { ownerUserId: unknown; creatorId: unknown }; follows: unknown }): CircleRepository {
  const adapter = (connection: typeof database): CircleRepository => ({
    insertMembership: async (ownerUserId, creatorId) => {
      await connection.insert(tables.memberships).values({ ownerUserId, creatorId }).onConflictDoNothing();
    },
    insertFollow: async (ownerUserId, creatorId) => {
      await connection.insert(tables.follows).values({ followerUserId: ownerUserId, creatorId }).onConflictDoNothing();
    },
    deleteMembership: async (ownerUserId, creatorId) => {
      await connection.delete(tables.memberships).where(and(eq(tables.memberships.ownerUserId as any, ownerUserId), eq(tables.memberships.creatorId as any, creatorId)));
    },
    transaction: async (work) => connection.transaction((tx: any) => work(adapter(tx as typeof database))),
  });
  return adapter(database);
}

export async function addCircleMember(repo: CircleRepository, ownerUserId: string, creatorId: string) {
  const work = async (current: CircleRepository) => {
    await current.insertMembership(ownerUserId, creatorId);
    await current.insertFollow(ownerUserId, creatorId);
  };
  if (repo.transaction) await repo.transaction(work);
  else await work(repo);
}

export async function removeCircleMember(repo: CircleRepository, ownerUserId: string, creatorId: string) {
  await repo.deleteMembership(ownerUserId, creatorId);
}