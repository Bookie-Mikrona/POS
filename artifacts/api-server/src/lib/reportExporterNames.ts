import type { clerkClient } from "@clerk/express";

/** Keep the SDK contract shared by the history route and the opt-in live test. */
export async function resolveReportExporterNames(
  exporterIds: string[],
  usersApi: Pick<typeof clerkClient.users, "getUserList">,
): Promise<Map<string, string>> {
  const userIds = [...new Set(exporterIds.filter(Boolean))];
  const displayNames = new Map<string, string>();
  for (let offset = 0; offset < userIds.length; offset += 100) {
    const { data: users } = await usersApi.getUserList({
      userId: userIds.slice(offset, offset + 100),
      limit: 100,
    });
    for (const user of users) {
      const name = [user.firstName?.trim(), user.lastName?.trim()].filter(Boolean).join(" ");
      const email = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)
        ?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
      displayNames.set(user.id, name || email?.trim() || "Neznan uporabnik");
    }
  }
  return displayNames;
}
