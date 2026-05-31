import * as fs from 'fs';
import * as net from 'net';

import config from '@utils/configuration';
import { Logger } from '@utils/logger';

export interface NatPortConfig
{
	node_port?: number;
	vpn_type?: string;
	vpn_port?: number;
	vpn_protocol?: string;
}

export interface NatMapping
{
	id: string;
	protocol: 'TCP' | 'UDP';
	external_port: number;
	internal_port: number;
	internal_client?: string;
	lease_seconds?: number;
	description?: string;
	enabled?: boolean;
}

interface NatRequest
{
	action: 'ping' | 'sync' | 'status' | 'clear' | 'refresh';
	mappings?: NatMapping[];
}

interface NatResponse
{
	ok?: boolean;
	action?: string;
	error?: string;
	count?: number;
	[key: string]: unknown;
}

class NatManager
{
	private static instance: NatManager;
	private runtimeDisabled = false;

	private constructor()
	{
	}

	public static getInstance(): NatManager
	{
		if (!NatManager.instance)
			NatManager.instance = new NatManager();

		return NatManager.instance;
	}

	public async syncConfiguredMappings(portConfig: NatPortConfig): Promise<boolean>
	{
		if (!this.isEnabled())
			return true;

		if (!await this.ensureServiceAvailable())
			return false;

		const mappings = this.buildMappings(portConfig);
		const response = await this.sendCommand({
			action: 'sync',
			mappings,
		});

		if (!response?.ok)
		{
			Logger.error(`NAT sync failed: ${response?.error || 'invalid response from daemon'}`);
			return false;
		}

		Logger.info(`NAT mappings synchronized (${mappings.length} desired mapping(s)).`);
		return true;
	}

	public async clearMappings(): Promise<boolean>
	{
		if (!this.isEnabled())
			return true;

		if (!await this.ensureServiceAvailable())
			return false;

		const response = await this.sendCommand({
			action: 'clear',
		});

		if (!response?.ok)
		{
			Logger.error(`NAT clear failed: ${response?.error || 'invalid response from daemon'}`);
			return false;
		}

		Logger.info('NAT mappings cleared.');
		return true;
	}

	public async status(): Promise<NatResponse | null>
	{
		if (!this.isEnabled())
			return null;

		if (!await this.ensureServiceAvailable())
			return null;

		return this.sendCommand({
			action: 'status',
		});
	}

	public async refresh(): Promise<boolean>
	{
		if (!this.isEnabled())
			return true;

		if (!await this.ensureServiceAvailable())
			return false;

		const response = await this.sendCommand({
			action: 'refresh',
		});
		return response?.ok === true;
	}

	public async ping(): Promise<boolean>
	{
		if (!this.isEnabled())
			return false;

		const response = await this.sendCommand({
			action: 'ping',
		});
		return response?.ok === true;
	}

	private isEnabled(): boolean
	{
		const raw = config.UPNP_ENABLED;
		if (typeof raw === 'boolean')
			return raw;

		const normalized = String(raw || '').trim().toLowerCase();
		return ['1', 'true', 'yes', 'on'].includes(normalized);
	}

	private async ensureServiceAvailable(): Promise<boolean>
	{
		if (this.runtimeDisabled)
			return false;

		const socketPath = this.getSocketPath();
		if (!fs.existsSync(socketPath))
		{
			this.disableRuntime(`NAT socket not found at ${socketPath}. Feature disabled until process restart.`);
			return false;
		}

		const alive = await this.ping();
		if (!alive)
		{
			this.disableRuntime(`NAT daemon did not respond on ${socketPath}. Feature disabled until process restart.`);
			return false;
		}

		return true;
	}

	private disableRuntime(message: string): void
	{
		this.runtimeDisabled = true;
		Logger.info(message);
	}

	private buildMappings(portConfig: NatPortConfig): NatMapping[]
	{
		const mappings: NatMapping[] = [];
		const leaseSeconds = this.getLeaseSeconds();
		const internalClient = this.getInternalClient();

		if (this.isValidPort(portConfig.node_port))
		{
			mappings.push({
				id: 'casanode-node',
				protocol: 'TCP',
				external_port: portConfig.node_port,
				internal_port: portConfig.node_port,
				internal_client: internalClient,
				lease_seconds: leaseSeconds,
				description: config.UPNP_NODE_DESCRIPTION || 'Casanode node',
				enabled: true,
			});
		}

		const vpnProtocol = this.resolveVpnProtocol(portConfig.vpn_type, portConfig.vpn_protocol);
		if (vpnProtocol && this.isValidPort(portConfig.vpn_port))
		{
			mappings.push({
				id: 'casanode-vpn',
				protocol: vpnProtocol,
				external_port: portConfig.vpn_port,
				internal_port: portConfig.vpn_port,
				internal_client: internalClient,
				lease_seconds: leaseSeconds,
				description: config.UPNP_VPN_DESCRIPTION || 'Casanode VPN',
				enabled: true,
			});
		}

		return mappings.map((mapping) =>
		{
			if (!mapping.internal_client)
				delete mapping.internal_client;
			return mapping;
		});
	}

	private resolveVpnProtocol(vpnType?: string, vpnProtocol?: string): 'TCP' | 'UDP' | null
	{
		if (!vpnType)
			return null;

		if (vpnType === 'wireguard')
			return 'UDP';
		if (vpnType === 'v2ray')
			return 'TCP';
		if (vpnType === 'openvpn')
		{
			const normalized = (vpnProtocol || 'udp').trim().toLowerCase();
			if (normalized === 'tcp')
				return 'TCP';
			return 'UDP';
		}

		Logger.error(`Unsupported VPN type for NAT mapping: ${vpnType}`);
		return null;
	}

	private isValidPort(port?: number): port is number
	{
		return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535;
	}

	private getSocketPath(): string
	{
		return String(config.UPNP_CONTROL_SOCKET || '/run/casanode-natd/control.sock');
	}

	private getLeaseSeconds(): number
	{
		const value = parseInt(String(config.UPNP_LEASE_SECONDS || '3600'), 10);
		return Number.isFinite(value) && value > 0 ? value : 3600;
	}

	private getInternalClient(): string | undefined
	{
		const internalClient = String(config.UPNP_INTERNAL_CLIENT || '').trim();
		return internalClient.length > 0 ? internalClient : undefined;
	}

	private async sendCommand(request: NatRequest): Promise<NatResponse | null>
	{
		const socketPath = this.getSocketPath();

		return new Promise<NatResponse | null>((resolve) =>
		{
			let settled = false;
			let buffer = '';

			const finish = (value: NatResponse | null): void =>
			{
				if (settled)
					return;
				settled = true;
				resolve(value);
			};

			const socket = net.createConnection(socketPath);

			socket.setEncoding('utf8');
			socket.setTimeout(5000);

			socket.on('connect', () =>
			{
				socket.write(`${JSON.stringify(request)}\n`);
			});

			socket.on('data', (chunk: string) =>
			{
				buffer += chunk;
				if (!buffer.includes('\n'))
					return;

				const line = buffer.split('\n')[0].trim();
				socket.end();
				if (!line)
				{
					finish(null);
					return;
				}

				try
				{
					finish(JSON.parse(line) as NatResponse);
				}
				catch (error)
				{
					Logger.error(`Failed to parse NAT daemon response: ${String(error)}`);
					finish(null);
				}
			});

			socket.on('timeout', () =>
			{
				Logger.error(`NAT daemon request timed out on ${socketPath}`);
				socket.destroy();
				finish(null);
			});

			socket.on('error', (error) =>
			{
				Logger.error(`NAT daemon communication failed: ${error.message}`);
				finish(null);
			});

			socket.on('end', () =>
			{
				if (!settled)
				{
					const line = buffer.trim();
					if (!line)
					{
						finish(null);
						return;
					}

					try
					{
						finish(JSON.parse(line) as NatResponse);
					}
					catch (error)
					{
						Logger.error(`Failed to parse NAT daemon response: ${String(error)}`);
						finish(null);
					}
				}
			});
		});
	}
}

const natManager = NatManager.getInstance();

export default natManager;
export const clearNatMappings = (): Promise<boolean> => natManager.clearMappings();
export const getNatStatus = (): Promise<NatResponse | null> => natManager.status();
export const refreshNatMappings = (): Promise<boolean> => natManager.refresh();
export const syncConfiguredNatMappings = (portConfig: NatPortConfig): Promise<boolean> => natManager.syncConfiguredMappings(portConfig);
