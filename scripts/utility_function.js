import { fromZonedTime } from 'date-fns-tz';

export function compUrl(comp) {
    return 'https://www.worldcubeassociation.org/competitions/' + comp.id;
}

export function dateToUnix(date) {
    const d = new Date(date);
    return Math.floor(d.getTime() / 1000);
}

export function crowDistance(lat1, lon1, lat2, lon2) {
    function deg2rad(deg) {
        return deg * (Math.PI / 180);
    }
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c;
    return d;
}

export async function eventIconString(client, event) {

    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    const guild = channel.guild;

    const emoji = guild.emojis.cache.find(emojis => emojis.name === event);
    if (!emoji) {
        return '<unkown event name>';
    }
    return `<:${event}:${emoji.id}>`;
}

export function compStartTime(comp) {
    return fromZonedTime(comp.schedule.startDate, comp.schedule.venues[0].timezone);
}