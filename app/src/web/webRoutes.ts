import express, { Router, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import QRCode from 'qrcode';
import config from '@utils/configuration';
import nodeManager from '@utils/node';
import { getLocalIPAddress } from '@utils/network';
import { Logger } from '@utils/logger';

// Create __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a new router
const webRouter = Router();
// Define the base directory
const baseDir = process.env.BASE_DIR || path.resolve(__dirname, '../../');
// Define the assets directory
const assetsDir = path.join(baseDir, 'web');

/**
 * Serve static files from the assets directory
 */
webRouter.use('/assets', express.static(assetsDir));

/**
 * Serve the index.html file
 */
webRouter.get('/', async (req: Request, res: Response) =>
{
	// Get node configuration
	const nodeConfig = nodeManager.getConfig();
	// Get local IP address
	const localIPAddress = getLocalIPAddress();
	
	// QR code data
	const qrData: QRData = {
		device: 'casanode',
		os: nodeConfig.systemOs,
		kernel: nodeConfig.systemKernel,
		architecture: nodeConfig.systemArch,
		ip: localIPAddress,
		webPort: config.WEB_LISTEN.split(':')[1] || 8080,
		apiPort: config.API_LISTEN.split(':')[1] || 8081,
		authToken: config.API_AUTH,
	};
	
	
	// Generate QR code data URL
	const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrData));
	// Read the HTML file
	const htmlFilePath = path.join(assetsDir, 'index.html');
	
	// Read the HTML file
	fs.readFile(htmlFilePath, 'utf8',(err, html) =>
	{
		// Send error if file could not be loaded
		if (err)
		{
			Logger.error('Error loading HTML file');
			res.status(500).send('Error loading HTML file');
			return;
		}
		
		Logger.info('Serving HTML file');
		// Replace the placeholder with the QR code data URL
		const modifiedHtml = html.replace('QR_CODE_DATA_URL', qrCodeDataURL);
		// Send the modified HTML file
		res.send(modifiedHtml);
	});
});

interface QRData {
    device: string;
    os: string;
    kernel: string;
    architecture: string;
    ip: string | null;
    webPort: string | number;
    apiPort: string | number;
    authToken: string;
}

export default webRouter;
