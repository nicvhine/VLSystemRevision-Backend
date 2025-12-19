require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;

async function updateCollectionStatuses() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collectionsCol = db.collection('collections');
    const now = new Date();
    let updatedCount = 0;

    const collections = await collectionsCol.find({}).toArray();

    console.log(`\n📊 Found ${collections.length} total collections`);
    console.log(`Current date: ${now.toLocaleDateString()}\n`);

    for (const col of collections) {
      const { dueDate, referenceNumber, status } = col;
      if (!dueDate || status === 'Paid') continue;

      const due = new Date(dueDate);
      const daysLate = Math.floor((now - due) / (1000 * 60 * 60 * 24));
      let newStatus = status;

      console.log(`\n📝 Collection ${referenceNumber}:`);
      console.log(`   Current Status: ${status}`);
      console.log(`   Due Date: ${due.toLocaleDateString()}`);
      console.log(`   Days Late: ${daysLate}`);

      if (status === 'Unpaid' && daysLate > 30) {
        newStatus = 'Overdue';
      } else if (status === 'Unpaid' && daysLate > 3) {
        newStatus = 'Past Due';
      } else if (status === 'Past Due' && daysLate > 30) {
        newStatus = 'Overdue';
      }

      if (newStatus !== status) {
        await collectionsCol.updateOne(
          { referenceNumber }, 
          { $set: { status: newStatus, lastStatusUpdated: now } }
        );
        updatedCount++;
        console.log(`   ✅ Updated to: ${newStatus}`);
      } else {
        console.log(`   ⏸️  No change needed`);
      }
    }

    console.log(`\n✅ Updated ${updatedCount} collection(s) total`);
  } catch (err) {
    console.error('❌ Error during status update:', err);
  } finally {
    await client.close();
  }
}

updateCollectionStatuses();
