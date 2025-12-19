require('dotenv').config();
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function seedSysAd() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'VLSystem');
    const users = db.collection('users');

    const hashedPassword = await bcrypt.hash('SysAd@123', 10);

    const sysad = {
      userId: '00001',
      name: 'System Administrator',
      username: 'sysad',
      email: 'vistulalendingsysad@gmail.com',
        password: hashedPassword,
      role: 'sysad',
      isFirstLogin: true,
      status: "Active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await users.insertOne(sysad);

    console.log('SysAd account created successfully!');
    console.log('Username: sysad');
    console.log('Password: SysAd@123');
    console.log('User ID: 00001');
  } catch (err) {
    console.error('Error seeding SysAd:', err);
  } finally {
    await client.close();
  }
}

seedSysAd();
