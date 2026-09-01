export function indicator(name, ...params) {
    return { name, params };
}
export function indicatorKey(ref) {
    return `${ref.name}(${ref.params.join(",")})`;
}
