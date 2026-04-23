import { normalizeShopifyProduct } from "../lib/normalize.js";

const SHOPIFY_API_VERSION = "2026-04";

const SEARCH_PRODUCTS_QUERY = `
query SearchProducts($first: Int!, $query: String!) {
  products(first: $first, query: $query) {
    edges {
      node {
        id
        title
        vendor
        productType
        tags
        onlineStoreUrl
        featuredImage {
          url
        }
        images(first: 3) {
          edges {
            node {
              url
            }
          }
        }
        variants(first: 1) {
          edges {
            node {
              price {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
}
`;

function validateStore(store) {
  return (
    store &&
    typeof store.name === "string" &&
    typeof store.domain === "string" &&
    typeof store.storefrontToken === "string" &&
    store.name.trim() &&
    store.domain.trim() &&
    store.storefrontToken.trim()
  );
}

async function searchSingleStore({ store, query, first }) {
  if (!validateStore(store)) {
    throw new Error(`Invalid store config for ${JSON.stringify(store)}`);
  }

  const endpoint = `https://${store.domain}/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": store.storefrontToken
    },
    body: JSON.stringify({
      query: SEARCH_PRODUCTS_QUERY,
      variables: {
        first,
        query
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.errors?.[0]?.message ||
      `Shopify request failed for ${store.name}`
    );
  }

  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    throw new Error(
      data.errors[0]?.message || `GraphQL error for ${store.name}`
    );
  }

  const edges = data?.data?.products?.edges || [];

  return edges
    .map(edge => normalizeShopifyProduct(edge?.node, store))
    .filter(Boolean);
}

export async function searchShopifyStores({ stores, query, perStoreLimit = 6 }) {
  const settled = await Promise.allSettled(
    stores.map(store =>
      searchSingleStore({
        store,
        query,
        first: perStoreLimit
      })
    )
  );

  const items = [];
  const errors = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      errors.push(result.reason?.message || "Unknown provider error");
    }
  }

  if (items.length === 0 && errors.length) {
    throw new Error(errors[0]);
  }

  return items;
}
