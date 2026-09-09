const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const restoreDb = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB for restoration');

        const db = mongoose.connection.db;
        const dumpDir = path.join(__dirname, 'db_dump_json');
        
        if (!fs.existsSync(dumpDir)) {
            console.error('db_dump_json folder not found.');
            process.exit(1);
        }

        const files = fs.readdirSync(dumpDir).filter(file => file.endsWith('.json'));

        for (const file of files) {
            const collectionName = file.replace('.json', '');
            const filePath = path.join(dumpDir, file);
            
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            
            if (data.length > 0) {
                const collection = db.collection(collectionName);
                
                // Clear existing data before restore
                await collection.deleteMany({});
                
                // Convert string _id back to ObjectId
                const docs = data.map(doc => {
                    if (doc._id) doc._id = new mongoose.Types.ObjectId(doc._id);
                    if (doc.category) doc.category = new mongoose.Types.ObjectId(doc.category);
                    if (doc.product) doc.product = new mongoose.Types.ObjectId(doc.product);
                    return doc;
                });

                await collection.insertMany(docs);
                console.log(`Restored ${docs.length} documents to ${collectionName}`);
            } else {
                console.log(`Skipped ${collectionName} (no documents)`);
            }
        }

        console.log('Database restoration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Error restoring database:', error);
        process.exit(1);
    }
};

restoreDb();
