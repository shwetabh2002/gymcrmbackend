/**
 * One-time fix: reassign duplicate member idNo values.
 *
 * Keeps the earliest-created member on the original idNo.
 * Later duplicates get the next free DLF-* numbers (from max+1).
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/fix-duplicate-idnos.ts
 * Dry run: DRY_RUN=1 npx ts-node -r tsconfig-paths/register scripts/fix-duplicate-idnos.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

type DupGroup = {
  _id: string;
  count: number;
  members: Array<{
    _id: mongoose.Types.ObjectId;
    name: string;
    phone: string | null;
    createdAt: Date;
  }>;
};

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(uri);
  const users = mongoose.connection.db!.collection('users');

  const dups = (await users
    .aggregate([
      {
        $match: {
          userType: 'MEMBER',
          idNo: { $nin: [null, ''] },
        },
      },
      {
        $group: {
          _id: '$idNo',
          count: { $sum: 1 },
          members: {
            $push: {
              _id: '$_id',
              name: '$name',
              phone: '$phone',
              createdAt: '$createdAt',
            },
          },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray()) as DupGroup[];

  console.log(`Found ${dups.length} duplicate idNo group(s). DRY_RUN=${DRY_RUN}`);

  const maxAgg = await users
    .aggregate<{ maxNum: number }>([
      { $match: { userType: 'MEMBER', idNo: { $regex: /^DLF-\d+$/ } } },
      {
        $project: {
          num: {
            $toInt: { $arrayElemAt: [{ $split: ['$idNo', '-'] }, 1] },
          },
        },
      },
      { $group: { _id: null, maxNum: { $max: '$num' } } },
    ])
    .toArray();

  let nextNum = (maxAgg[0]?.maxNum ?? 640) + 1;
  const changes: Array<{
    from: string;
    to: string;
    name: string;
    phone: string | null;
    memberId: string;
  }> = [];

  for (const group of dups) {
    const sorted = [...group.members].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const [keeper, ...rest] = sorted;
    console.log(
      `Keep ${group._id} → ${keeper.name} (${keeper._id.toString()})`,
    );

    for (const m of rest) {
      const newIdNo = `DLF-${nextNum++}`;
      changes.push({
        from: group._id,
        to: newIdNo,
        name: m.name,
        phone: m.phone,
        memberId: m._id.toString(),
      });
      console.log(
        `  Reassign ${m.name} (${m._id.toString()}) ${group._id} → ${newIdNo}`,
      );

      if (!DRY_RUN) {
        await users.updateOne(
          { _id: m._id },
          { $set: { idNo: newIdNo } },
        );
      }
    }
  }

  console.log(`\nTotal reassignments: ${changes.length}`);

  if (!DRY_RUN && changes.length > 0) {
    // Ensure unique sparse index after cleanup
    try {
      await users.createIndex(
        { idNo: 1 },
        { unique: true, sparse: true, name: 'idNo_1' },
      );
      console.log('Unique sparse index on idNo created/ensured.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Index create warning: ${msg}`);
    }
  } else if (DRY_RUN) {
    console.log('Dry run only — no DB writes. Re-run without DRY_RUN=1 to apply.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
