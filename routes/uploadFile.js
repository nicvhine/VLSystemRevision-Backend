const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const multer = require('multer');
const cloudinary = require('../utils/cloudinary');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      cb(new Error('Only JPEG and PNG are allowed'));
    } else if (file.size > 5 * 1024 * 1024) {
      cb(new Error('File size must be less than 5MB'));
    } else {
      cb(null, true);
    }
  },
});

module.exports = (db) => {
  // Upload single file to Cloudinary
  router.post(
    '/upload',
    authenticateToken,
    upload.single('file'),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: 'No file provided' });
        }

        const folder = req.body.folder || 'VLSystem/uploads';
        const base64String = req.file.buffer.toString('base64');
        const dataUri = `data:${req.file.mimetype};base64,${base64String}`;

        const result = await cloudinary.uploader.upload(dataUri, {
          folder,
          resource_type: 'auto',
          use_filename: false,
          unique_filename: true,
        });

        res.status(200).json({
          message: 'File uploaded successfully',
          filePath: result.secure_url,
          fileName: result.public_id,
          mimeType: result.format,
        });
      } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ message: 'Failed to upload file' });
      }
    }
  );

  return router;
};
