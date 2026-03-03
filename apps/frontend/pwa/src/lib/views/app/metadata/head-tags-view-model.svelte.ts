import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
  type RouteName,
} from '@aikami/frontend/services/index.ts';
import { routerService } from '$services/index.ts';

const jsonLd = (data: Record<string, unknown>): string => {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
};

export type BaseMetaTags = {
  author?: string;
  createdAt?: Date;
  description?: string;
  image?: string;
  keywords?: string[];
  title: string;
  type?: string;
  video?: string;
  searchURL?: string;
};

export type MetaTagArticleProperties = {
  modified_time: string;
  published_time: string;
  section: string;
  tag: string;
};

export type MetaTagImageProperties = {
  alt: string;
  height: string;
  url: string;
  width: string;
};

export type MetaTagOpenGraphProperties = {
  audio: string;
  'audio:secure_url': string;
  'audio:type': string;
  description: string;
  determiner: string;
  image: string;
  'image:alt': string;
  'image:height': string;
  'image:secure_url': string;
  'image:type': string;
  'image:url': string;
  'image:width': string;
  locale: string;
  'locale:alternate': string;
  site_name: string;
  title: string;
  type: string;
  url: string;
  video: string;
  'video:alt': string;
  'video:height': string;
  'video:secure_url': string;
  'video:type': string;
  'video:url': string;
  'video:width': string;
};

export type MetaTagTwitterProperties = {
  'app:id:googleplay': string;
  'app:id:ipad': string;
  'app:id:iphone': string;
  'app:name:googleplay': string;
  'app:name:ipad': string;
  'app:name:iphone': string;
  'app:url:googleplay': string;
  'app:url:ipad': string;
  'app:url:iphone': string;
  card: string;
  creator: string;
  'creator:id': string;
  data1: string;
  data2: string;
  description: string;
  image: string;
  'image:alt': string;
  'image:height': string;
  'image:width': string;
  label1: string;
  label2: string;
  player: string;
  'player:height': string;
  'player:stream': string;
  'player:width': string;
  site: string;
  'site:id': string;
  title: string;
};

export type MetaTagProperties = {
  article: Partial<MetaTagArticleProperties>;
  atom: string;
  author: string;
  description: string;
  image: Partial<MetaTagImageProperties>;
  keywords: string[];
  logoURL: string;
  openGraph: Partial<MetaTagOpenGraphProperties>;
  robots: string;
  searchURL: string;
  sitemapURL: string;
  title: string;
  twitter: Partial<MetaTagTwitterProperties>;
  url: string;
};

export type MetaTags = Partial<MetaTagProperties>;

export type HeadTagsViewModelOptions = BaseViewModelOptions;

export type HeadTagsViewModelInterface = BaseViewModelInterface & {
  /**
   * The base metadata for the page.
   */
  readonly baseMetadata: () => BaseMetaTags;

  /**
   * The full metadata for the page.
   */
  readonly fullMetadata: () => MetaTags;

  /**
   * The JSON-LD for the organization.
   */
  readonly organizationJsonLd: () => string | null;

  /**
   * The JSON-LD for the search action.
   */
  readonly searchActionJsonLd: () => string | null;

  /**
   * Sets the metadata for the page.
   * @param data The metadata to set.
   */
  setData(data: BaseMetaTags): void;

  /**
   * Sets the base URL for the page.
   * @param baseURL The base URL to set.
   */
  setBaseURL(baseURL: string): void;

  /**
   * Sets the path for the page.
   * @param path The path to set.
   */
  setPath(path: string): void;
};

class HeadTagsViewModel
  extends BaseViewModel<HeadTagsViewModelOptions>
  implements HeadTagsViewModelInterface
{
  /**
   * The metadata for the page.
   */
  private _data = $state<BaseMetaTags | null>(null);

  /**
   * The base URL for the page.
   */
  private _baseURL = $state<string>('');

  /**
   * The path for the page.
   */
  private _path = $state<string>('');

  baseMetadata = $derived((): BaseMetaTags => {
    const currentRoute = routerService.currentRoute;

    const defaultMetadata: BaseMetaTags = {
      description: 'Aikami',
      keywords: ['ai'],
      title: this._getTitle({ currentRoute }),
    };

    return this._data ? { ...defaultMetadata, ...this._data } : defaultMetadata;
  });

  fullMetadata = $derived((): MetaTags => {
    const data = this.baseMetadata();
    const url = this._baseURL && this._path ? `${this._baseURL}${this._path}` : undefined;

    if (!data) {
      return {};
    }

    const openGraph: Partial<MetaTagOpenGraphProperties> = {
      description: data.description,
      locale: 'en_US',
      title: data.title,
      type: data.type,
      url: url,
    };

    const twitter: Partial<MetaTagTwitterProperties> = {
      description: data.description,
      title: data.title,
    };

    const image: Partial<MetaTagImageProperties> = {
      alt: data.title,
      url: data.image,
    };

    if (data.video) {
      openGraph.video = data.video;
      openGraph['video:type'] = 'video/mp4';
      openGraph['video:alt'] = data.title;

      twitter.player = data.video;
    }

    if (data.image) {
      openGraph.image = data.image;
      openGraph['image:alt'] = data.title;

      twitter.image = data.image;
      twitter['image:alt'] = data.title;
    }

    return {
      ...data,
      image,
      openGraph,
      robots: 'index,follow',
      twitter,
      url,
    };
  });

  organizationJsonLd = $derived((): string | null => {
    if (!this._baseURL) return null;

    return jsonLd({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      logo: `${this._baseURL}/favicon.ico`,
      url: this.fullMetadata().url,
    });
  });

  searchActionJsonLd = $derived((): string | null => {
    const metadata = this.fullMetadata();
    if (!metadata.url || !metadata.searchURL) return null;

    return jsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      potentialAction: {
        '@type': 'SearchAction',
        'query-input': 'required name=search_term_string',
        target: metadata.searchURL,
      },
      url: metadata.url,
    });
  });

  setData(data: BaseMetaTags): void {
    this._data = data;
  }

  setBaseURL(baseURL: string): void {
    this._baseURL = baseURL;
  }

  setPath(path: string): void {
    this._path = path;
  }

  /**
   * Gets the title for the page.
   * @param _options The options.
   * @returns The title for the page.
   */
  private _getTitle(_options: { currentRoute?: RouteName }): string {
    // TODO use currentRoute to set the title
    return 'AiKami';
  }
}

export const getHeadTagsViewModel = (
  options: HeadTagsViewModelOptions,
): HeadTagsViewModelInterface => new HeadTagsViewModel(options);
