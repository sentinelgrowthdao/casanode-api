import {
	checkImageAvailability,
	containerExists,
	containerRunning,
} from '@utils/docker';

import {
	isNodeConfigFileAvailable,
	isCertificateKeyAvailable,
	isWalletAvailable,
} from '@utils/node';

export interface InstallationCheck
{
	image: boolean;
	containerExists: boolean;
	containerRunning: boolean;
	nodeConfig: boolean;
	certificateKey: boolean;
	wallet: boolean;
};

export const checkInstallation = async (): Promise<InstallationCheck> =>
{
	// Return the installation check
	return {
		image: await checkImageAvailability(),
		containerExists: await containerExists(),
		containerRunning: await containerRunning(),
		nodeConfig: isNodeConfigFileAvailable(),
		certificateKey: isCertificateKeyAvailable(),
		wallet: await isWalletAvailable(),
	};
};
