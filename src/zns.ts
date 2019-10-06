import { Zilliqa } from '@zilliqa-js/zilliqa';
import { Contract } from '@zilliqa-js/contract';
import { toChecksumAddress } from '@zilliqa-js/crypto';
import namehash from './zns/namehash';
import _ from 'lodash';
import { ResolutionResult, SourceDefinition } from './types';

const DefaultSource = 'https://api.zilliqa.com/';
const NullAddress = '0x0000000000000000000000000000000000000000';

const NetworkIdMap = {
  1: 'mainnet',
  3: 'ropsten',
  4: 'kovan',
  42: 'rinkeby',
  5: 'goerli',
};

const RegistryMap = {
  mainnet: 'zil1jcgu2wlx6xejqk9jw3aaankw6lsjzeunx2j0jz',
};

export default class {
  readonly network: string;
  readonly url: string;
  private registryAddress: string;
  registry: Contract;
  zilliqa: Zilliqa;

  constructor(source: string | boolean | SourceDefinition = true) {
    source = this.normalizeSource(source);
    this.network = <string>source.network;
    this.url = source.url;
    this.zilliqa = new Zilliqa(this.url);
    if (!this.network) {
      throw new Error('Unspecified network in Namicorn ENS configuration');
    }
    if (!this.url) {
      throw new Error('Unspecified url in Namicorn ENS configuration');
    }
    this.registryAddress = RegistryMap[this.network];
    if (this.registryAddress)
      this.registry = this.zilliqa.contracts.at(this.registryAddress);
  }

  async getContractField(
    contract: Contract,
    field: string,
    keys: string[] = [],
  ): Promise<any> {
    let response = await this.zilliqa.provider.send(
      'GetSmartContractSubState',
      contract.address.replace('0x', '').toLowerCase(),
      field,
      keys.map(k => JSON.stringify(k)),
    );
    return (response.result || {})[field];
  }

  async getContractMapValue(
    contract: Contract,
    field: string,
    key: string,
  ): Promise<any> {
    const record = await this.getContractField(contract, field, [key]);
    return (record && record[key]) || null;
  }

  async getResolverRecordsStructure(
    resolverAddress: string,
  ): Promise<ResolutionResult> {
    if (resolverAddress == NullAddress) {
      return {};
    }
    const resolver = this.zilliqa.contracts.at(
      toChecksumAddress(resolverAddress),
    );
    const resolverRecords = (await this.getContractField(
      resolver,
      'records',
    )) as { [key: string]: string };
    return _.transform(
      resolverRecords,
      (result, value, key) => _.set(result, key, value),
      {},
    );
  }

  async resolve(domain: string): Promise<ResolutionResult | null> {
    if (!this.isSupportedDomain(domain) || !this.isSupportedNetwork())
      return null;

    const registryRecord = await this.getContractMapValue(
      this.registry,
      'records',
      namehash(domain),
    );

    if (!registryRecord) return null;
    const [ownerAddress, resolverAddress] = registryRecord.arguments as [
      string,
      string
    ];
    const resolution = await this.getResolverRecordsStructure(resolverAddress);
    const addresses = _.mapValues(resolution.crypto, 'address');
    return {
      addresses,
      meta: {
        owner: ownerAddress || null,
        type: 'zns',
        ttl: parseInt(resolution.ttl as string) || 0,
      },
    };
  }

  isSupportedDomain(domain: string): boolean {
    return domain.indexOf('.') > 0 && /^.{1,}\.(zil)$/.test(domain);
  }

  isSupportedNetwork(): boolean {
    return this.registryAddress != null;
  }

  private normalizeSource(
    source: string | boolean | SourceDefinition,
  ): SourceDefinition {
    switch (typeof source) {
      case 'boolean': {
        return { url: DefaultSource, network: 'mainnet' };
      }
      case 'string': {
        return {
          url: source as string,
          network: 'mainnet',
        };
      }
      case 'object': {
        source = _.clone(source) as SourceDefinition;
        if (typeof source.network == 'number') {
          source.network = NetworkIdMap[source.network];
        }
        if (source.network && !source.url) {
          source.url = DefaultSource;
        }
        if (source.url && !source.network) {
          source.network = 'mainnet';
        }
        return source;
      }
    }
  }
}
