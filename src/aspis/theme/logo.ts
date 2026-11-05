// O símbolo do Escudo (a égide, com a Górgona): terracota no tema terracota, metálico
// no espacial e no ecológico. Todo uso do logo passa por aqui.
import type { ImageSourcePropType } from 'react-native';

import { TEMA } from '../../theme/tema';

export const LOGO_ESCUDO: ImageSourcePropType =
  TEMA === 'terracota'
    ? require('../../../assets/aspis/logo-mark.png')
    : require('../../../assets/aspis/logo-mark-metal.png');
