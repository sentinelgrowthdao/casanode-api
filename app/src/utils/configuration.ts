import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@utils/logger';

export interface AppConfigData
{
	[key: string]: string | number | boolean | string[] | undefined;
	CASANODE_VERSION: string;
	DOCKER_IMAGE_NAME: string;
	DOCKER_CONTAINER_NAME: string;
	CONTAINER_DATA_DIR: string;
	CONFIG_DIR: string;
	LOG_DIR: string;
	DOCKER_SOCKET: string;
	DEVICE_ID: string;
	API_LISTEN: string;
	API_AUTH: string;
	JWT_SECRET: string;
	API_BALANCE: string[];
	FOXINODES_API_CHECK_IP: string;
	FOXINODES_API_DVPN_CONFIG: string;
	FOXINODES_API_CHECK_PORT: string;
	SENTRY_DSN?: string;
}

export interface ConfigFileData
{
	[key: string]: string;
}

export interface RemoteAddressData
{
	ip: string;
	country: string;
}

class ConfigurationLoader
{
	private static instance: ConfigurationLoader;
	private configFile = '/etc/casanode.conf';
	private config: AppConfigData;
	
	// Default configuration
	private defaultConfig: AppConfigData =
		{
			CASANODE_VERSION: 'alpha',
			DOCKER_CONTAINER_NAME: 'sentinel-dvpnx',
			CONTAINER_DATA_DIR: '/root/.sentinel-dvpnx',
			CONFIG_DIR: process.env.HOME ? path.join(process.env.HOME, '.sentinel-dvpnx') : '/opt/casanode/.sentinel-dvpnx',
			LOG_DIR: '/var/log/casanode',
			DOCKER_SOCKET: this.getDockerDefaultSocketPath(),
			DEVICE_ID: uuidv4(),
			API_LISTEN: '0.0.0.0:14045',
			API_AUTH: this.generateAuthToken(),
			JWT_SECRET: this.generateJwtSecret(),
			API_BALANCE: [
				'https://api-sentinel.busurnode.com/cosmos/bank/v1beta1/balances/',
				'https://api.sentinel.quokkastake.io/cosmos/bank/v1beta1/balances/',
				'https://wapi.foxinodes.net/api/v1/sentinel/address/'
			],
			FOXINODES_API_CHECK_IP: 'https://wapi.foxinodes.net/api/v1/sentinel/check-ip',
			FOXINODES_API_DVPN_CONFIG: 'https://wapi.foxinodes.net/api/v1/sentinel/dvpn-node/configuration',
			FOXINODES_API_CHECK_PORT: 'https://wapi.foxinodes.net/api/v1/sentinel/dvpn-node/check-port/',
			SENTRY_DSN: '',
		};
	
	private constructor()
	{
		this.config = this.loadConfig();
		this.saveConfig();
	}
	
	/**
	 * Get instance of ConfigurationLoader
	 * @returns ConfigurationLoader
	 */
	public static getInstance(): ConfigurationLoader
	{
		// Create instance if it does not exist
		if (!ConfigurationLoader.instance)
			ConfigurationLoader.instance = new ConfigurationLoader();
		// Return instance
		return ConfigurationLoader.instance;
	}
	
	/**
	 * Get current configuration
	 * @returns AppConfigData
	 */
	public getConfig(): AppConfigData
	{
		return this.config;
	}
	
	/**
	 * Reset the node configuration
	 * @returns void
	 */
	public resetConfiguration(): void
	{
		// Preserve the current API_AUTH so it is never regenerated during a factory reset
		const currentApiAuth = this.config?.API_AUTH;
		this.config = { ...this.defaultConfig };
		if (currentApiAuth)
		{
			this.config.API_AUTH = currentApiAuth;
		}
		// Save updated configuration with preserved API_AUTH
		this.saveConfig();
	}
	
	/**
	 * Load configuration from file and merge it with default configuration
	 */
	private loadConfig(): AppConfigData
	{
		const configFromFile = this.loadConfigFromFile();
		// Merge default and file configurations
		const mergedConfig = { ...this.defaultConfig, ...configFromFile };
		// Filter out undefined values
		const filteredConfig = Object.keys(mergedConfig).reduce((acc, key) =>
		{
			const value = mergedConfig[key];
			if (value !== undefined)
			{
				acc[key] = value;
			}
			return acc;
		}, {} as AppConfigData);
		// Save filtered configuration
		return filteredConfig;
	}
	
	/**
	 * Load configuration from file
	 * @returns Partial<AppConfigData>
	 */
	private loadConfigFromFile(): Partial<AppConfigData>
	{
		try
		{
			if (fs.existsSync(this.configFile))
			{
				// Parse configuration file
				const config: ConfigFileData = dotenv.parse(fs.readFileSync(this.configFile));
				const parsedConfig: Partial<AppConfigData> = {};
				
				// Manually parse arrays
				for (const key in config)
				{
					let value = config[key];
					
					// Skip keys with empty values
					if (!value.trim())
						continue;
					
					// Check if value is an array
					if (value.startsWith('[') && value.endsWith(']'))
					{
						parsedConfig[key] = value
							.slice(1, -1)
							.split(',')
							.map((item) => item.trim());
					}
					else
					{
						parsedConfig[key] = value;
					}
				}
				return parsedConfig;
			}
			else
			{
				console.error(`Configuration file ${this.configFile} does not exist. Using default values.`);
				return {};
			}
		}
		catch (error)
		{
			console.error(`An error occurred while loading configuration file: ${error}`);
			return {};
		}
	}
	
	/**
	 * Save configuration to file
	 * @returns boolean
	 */
	public saveConfig(): boolean
	{
		try
		{
			const configData = Object.entries(this.config)
				.map(([key, value]) =>
				{
					if (Array.isArray(value))
					{
						const arrayValues = value.join(',');
						return `${key}=[${arrayValues}]`;
					}
					else
					{
						return `${key}=${value}`;
					}
				})
				.join('\n');
			fs.writeFileSync(this.configFile, configData);
			return true;
		}
		catch (error)
		{
			console.error(`An error occurred while saving configuration file: ${error}`);
			return false;
		}
	}
	
	
	/**
	 * Get remote address
	 * @returns Promise<RemoteAddressData>
	 */
	public async getRemoteAddress(): Promise<RemoteAddressData>
	{
		// Initialize default values
		let nodeIP = '0.0.0.0';
		let nodeCountry = 'NA';
		
		try
		{
			// Attempt to get the IP and country from the primary API
			const response = await axios.get(this.config.FOXINODES_API_CHECK_IP, { timeout: 60000 });
			if (response.status === 200)
			{
				const data = response.data;
				nodeIP = data.ip || nodeIP;
				nodeCountry = data.iso_code || nodeCountry;
			}
			else
			{
				Logger.error('Failed to fetch IP from primary API.');
			}
		}
		catch (error)
		{
			Logger.error(`Primary API call failed: ${error}. Trying fallback method.`);
			try
			{
				// Fallback to checkip.dyndns.org
				const response = await axios.get('http://checkip.dyndns.org/', { timeout: 60000 });
				if (response.status === 200)
				{
					const value = response.data;
					nodeIP = value.split('Current IP Address: ')[1].split('<')[0];
				}
				else
				{
					Logger.error('Failed to fetch IP from fallback method.');
				}
			}
			catch (fallbackError)
			{
				Logger.error(`Fallback method also failed: ${fallbackError}.`);
			}
		}
		
		// Return IP and country
		return {
			ip: nodeIP,
			country: nodeCountry
		};
	}
	
	/**
	 * Refresh network configuration from the API
	 * @returns Promise<boolean>
	 */
	public async refreshNetworkConfiguration(): Promise<boolean>
	{
		try
		{
			// Fetch the configuration from the API
			const response = await axios.get(this.config.FOXINODES_API_DVPN_CONFIG, { timeout: 60000 });
			if (response.status === 200)
			{
				const data = response.data;
				// Check if the data is valid
				if (data && data.error === false)
				{
					// Extract the configuration data
					const chainId = data.chain_id || this.config.CHAIN_ID;
					const rpcAddresses = data.rpc_addresses || this.config.RPC_ADDRESSES;
					const gas = data.gas || this.config.GAS;
					const gasAdjustment = data.gas_adjustment || this.config.GAS_ADJUSTMENT;
					const gasPrice = data.gas_price || this.config.GAS_PRICE;
					const datacenterGigabytePrices = data.datacenter.gigabyte_prices || this.config.DATACENTER_GIGABYTE_PRICES;
					const datacenterHourlyPrices = data.datacenter.hourly_prices || this.config.DATACENTER_HOURLY_PRICES;
					const residentialGigabytePrices = data.residential.gigabyte_prices || this.config.RESIDENTIAL_GIGABYTE_PRICES;
					const residentialHourlyPrices = data.residential.hourly_prices || this.config.RESIDENTIAL_HOURLY_PRICES;
					
					// Update the configuration
					this.config = {
						...this.config,
						CHAIN_ID: chainId,
						RPC_ADDRESSES: rpcAddresses,
						GAS: gas,
						GAS_ADJUSTMENT: gasAdjustment,
						GAS_PRICE: gasPrice,
						DATACENTER_GIGABYTE_PRICES: datacenterGigabytePrices,
						DATACENTER_HOURLY_PRICES: datacenterHourlyPrices,
						RESIDENTIAL_GIGABYTE_PRICES: residentialGigabytePrices,
						RESIDENTIAL_HOURLY_PRICES: residentialHourlyPrices
					};
					
					// Log
					Logger.info('Network configuration has been refreshed.');
					return true;
				}
				else
				{
					Logger.error('Invalid network configuration data.');
				}
			}
			else
			{
				Logger.error('Failed to fetch network configuration.');
			}
		}
		catch (err)
		{
			if (err instanceof Error)
				Logger.error(`Failed to refresh network configuration: ${err.message}`);
			else
				Logger.error(`Failed to refresh network configuration: ${String(err)}`);
		}
		
		return false;
	}
	
	/**
	 * Get the default path for the Docker socket
	 * @returns string
	 */
	public getDockerDefaultSocketPath(): string
	{
		const userInfo = os.userInfo();
		const userId = userInfo.uid;
		return `/run/user/${userId}/docker.sock`;
	}
	
	/**
	 * Generate an authentication token
	 * @returns string
	 */
	private generateAuthToken(): string
	{
		return uuidv4();
	}

	/**
     * Generate a JWT secret
     * @returns string
     */
	private generateJwtSecret(): string
	{
		return uuidv4();
	}
}


// Exporter une instance unique de ConfigurationLoader
const configurationLoader = ConfigurationLoader.getInstance();
export default configurationLoader.getConfig();

export const getDockerDefaultSocketPath = (): string => configurationLoader.getDockerDefaultSocketPath();
export const getRemoteAddress = async (): Promise<RemoteAddressData> => configurationLoader.getRemoteAddress();
export const refreshNetworkConfiguration = async (): Promise<boolean> => configurationLoader.refreshNetworkConfiguration();
export const resetConfiguration = (): void => configurationLoader.resetConfiguration();