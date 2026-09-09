const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dumpDb = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();

        const dumpDir = path.join(__dirname, 'db_dump_json');
        if (!fs.existsSync(dumpDir)) {
            fs.mkdirSync(dumpDir);
        }

        for (const collectionInfo of collections) {
            const collectionName = collectionInfo.name;
            const collection = db.collection(collectionName);
            const documents = await collection.find({}).toArray();

            fs.writeFileSync(
                path.join(dumpDir, `${collectionName}.json`),
                JSON.stringify(documents, null, 2)
            );
            console.log(`Dumped ${documents.length} documents from ${collectionName}`);
        }

        console.log('Database dump completed successfully in db_dump_json folder.');
        process.exit(0);
    } catch (error) {
        console.error('Error dumping database:', error);
        process.exit(1);
    }
};

dumpDb();
