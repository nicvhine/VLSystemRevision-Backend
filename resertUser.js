require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function resetUsers() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'VLSystem');

    // Drop the users collection
    await db.collection('users').drop().catch(err => {
      if (err.codeName === 'NamespaceNotFound') {
        console.log('Users collection does not exist yet.');
      } else {
        throw err;
      }
    });

    console.log('Users collection has been reset.');
  } catch (err) {
    console.error('Error resetting users collection:', err);
  } finally {
    await client.close();
  }
}

resetUsers();
