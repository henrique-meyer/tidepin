# Third-party notices

## Geographic station time zones

The server uses [`geo-tz` 8.1.10](https://github.com/evansiroky/node-geo-tz), Copyright (c) 2016 Evan Siroky, under the MIT License. Its original license is retained in `node_modules/geo-tz/LICENSE.md` in the runtime dependency distribution. This repository does not modify the package or its boundary files.

The geographic data is derived from [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder) and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). The boundary database is available under the [Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The upstream [data license](https://github.com/evansiroky/timezone-boundary-builder/blob/master/DATA_LICENSE) and [data/source releases](https://github.com/evansiroky/timezone-boundary-builder/releases) remain available from the source project. The Docker image explicitly includes the repository's `THIRD-PARTY-NOTICES` file, preserving these data-license/source notices with redistributed runtime images.

This geographic database selects IANA time-zone rules; NOAA CO-OPS remains the sole source of tide predictions. Not for navigation.
